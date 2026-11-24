"""Song-level pass: makes the polished layers fit together.

1. Unmasking  - if a vocal is present, carve a little space for it in the
                other layers' presence range, scaled by how much they clash.
2. Low-end    - if a bass layer exists, guitars get a higher low cut.
3. Balance    - loudness-match layers so the lead sits on top.
4. Bus        - gentle glue compression, then loudness to a streaming target
                with a peak limiter.
"""
import numpy as np
import pyloudnorm as pyln
from pedalboard import Pedalboard, PeakFilter, HighpassFilter, Compressor

from analysis import band_balance, loudness
from chain import to_stereo

LEAD_LUFS = -18.0
SUPPORT_LUFS = -21.5
MASTER_LUFS = -14.0
CEILING_DB = -1.0


def _gain_to(y, sr, target):
    cur = loudness(y, sr)
    if cur < -60:
        return y, 0.0
    g = target - cur
    return y * (10 ** (g / 20)), g


def mix(layers, sr):
    """layers: dict name -> {'audio': mono np.array, 'type': str, 'pan': float}"""
    actions = []
    names = list(layers)
    n = max(len(l["audio"]) for l in layers.values())
    for l in layers.values():
        l["audio"] = np.pad(l["audio"], (0, n - len(l["audio"])))

    vocals = [k for k in names if layers[k]["type"] == "vocal"]
    has_bass = any(layers[k]["type"] == "bass" for k in names)

    if vocals:
        v_pres = max(band_balance(layers[k]["audio"], sr)["presence"] for k in vocals)
        for k in names:
            if k in vocals:
                continue
            o_pres = band_balance(layers[k]["audio"], sr)["presence"]
            cut = float(np.clip((o_pres - v_pres + 6) / 2, 0.5, 4.0))
            layers[k]["audio"] = Pedalboard([PeakFilter(cutoff_frequency_hz=2800, gain_db=-cut, q=1.0)])(
                layers[k]["audio"][None, :].astype(np.float32), sr)[0]
            actions.append(f"{k}: -{cut:.1f} dB at 2.8 kHz to make room for the vocal")

    if has_bass:
        for k in names:
            if "guitar" in layers[k]["type"]:
                layers[k]["audio"] = Pedalboard([HighpassFilter(cutoff_frequency_hz=110)])(
                    layers[k]["audio"][None, :].astype(np.float32), sr)[0]
                actions.append(f"{k}: low cut raised to 110 Hz to leave room for the bass")

    lead_types = {"vocal"} if vocals else {layers[names[0]]["type"]}
    stereo = np.zeros((2, n), dtype=np.float32)
    for k in names:
        offset = layers[k].get("level_db", 0.0)
        target = (LEAD_LUFS if layers[k]["type"] in lead_types else SUPPORT_LUFS) + offset
        a, g = _gain_to(layers[k]["audio"], sr, target)
        st = to_stereo(a, layers[k].get("pan", 0.0)).astype(np.float32)
        w = layers[k].get("width", 0.0)
        if w > 0.01:   # pseudo-stereo: delayed, low-cut copy added to L, subtracted from R (mono-compatible)
            d = int(0.011 * sr)
            delayed = np.concatenate([np.zeros(d, dtype=np.float32), a[:-d]]).astype(np.float32)
            side = Pedalboard([HighpassFilter(cutoff_frequency_hz=300)])(delayed[None, :], sr)[0] * (w * 0.5)
            st[0] += side; st[1] -= side
        actions.append(f"{k}: level {g:+.1f} dB (target {target:.1f} LUFS)" + (f", width {w:.0%}" if w > 0.01 else ""))
        stereo += st

    stereo = Pedalboard([Compressor(threshold_db=-16, ratio=2.0, attack_ms=20, release_ms=200)])(stereo, sr)
    actions.append("mix bus: glue compression 2:1")

    meter = pyln.Meter(sr)
    ceiling = 10 ** (CEILING_DB / 20)
    for _ in range(3):  # gain to target, limit peaks, re-measure
        cur = meter.integrated_loudness(stereo.T)
        stereo = stereo * (10 ** ((MASTER_LUFS - cur) / 20))
        stereo = peak_limit(stereo, sr, ceiling)
    final = meter.integrated_loudness(stereo.T)
    actions.append(f"master: loudness {final:.1f} LUFS (target {MASTER_LUFS}), peak ceiling {CEILING_DB} dBFS")
    return stereo.astype(np.float32), actions


def peak_limit(x, sr, ceiling, window_ms=5, release_ms=60):
    """Simple look-ahead peak limiter (predictable, no make-up gain)."""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    peak = np.abs(x).max(axis=0) + 1e-9
    g = np.minimum(1.0, ceiling / peak)
    w = max(int(sr * window_ms / 1000), 1)
    g = minimum_filter1d(g, size=2 * w + 1)
    g = minimum_filter1d(g, size=int(sr * release_ms / 1000))   # hold for release
    g = uniform_filter1d(g, size=w)                               # smooth
    out = x * g
    return np.clip(out, -ceiling, ceiling)
