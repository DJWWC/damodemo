"""Clean-up stage: noise, timing, tuning. Works only on the user's own audio.

Every function moves, re-pitches or attenuates parts of the original
recording. Nothing is synthesised or replaced.
"""
import numpy as np
import librosa
import noisereduce as nr

from analysis import (detect_onsets, track_pitch, segment_notes,
                      nearest_scale_midi, scale_pitch_classes)


def denoise(y, sr, strength):
    if strength <= 0:
        return y, "denoise skipped"
    strength = float(np.clip(strength, 0, 1))
    # learn the noise from the quietest 0.3 s of the take (count-in, gaps)
    w = int(0.3 * sr)
    hop = w // 2
    starts = range(0, max(len(y) - w, 1), hop)
    quiet = min(starts, key=lambda s: float(np.mean(y[s:s + w] ** 2)))
    out = nr.reduce_noise(y=y, sr=sr, y_noise=y[quiet:quiet + w], stationary=True,
                          prop_decrease=0.5 + 0.5 * strength, n_std_thresh_stationary=1.2)
    return out.astype(np.float32), f"stationary noise reduction at {strength:.0%}"


def gate_gaps(y, sr, strength):
    """Downward expander: turns down what's left of the noise in the gaps
    between notes/phrases. Applied after compression, which lifts quiet parts."""
    if strength <= 0:
        return y
    from pedalboard import Pedalboard, NoiseGate
    frame = 2048
    n = len(y) // frame
    rms = np.sqrt((y[: n * frame].reshape(n, frame) ** 2).mean(axis=1) + 1e-12)
    floor_db = 20 * np.log10(np.percentile(rms, 5))
    gate = NoiseGate(threshold_db=float(floor_db + 16), ratio=1 + 6 * strength, attack_ms=2, release_ms=150)
    return Pedalboard([gate])(y[None, :].astype(np.float32), sr)[0]


def tighten_timing(y, sr, grid, strength, max_shift_ms=80):
    """Slide each played event towards the nearest grid line.

    Each slice runs from its attack to the next attack. If moving opens a gap,
    the slice's own decay (from just before the next attack) is spliced in to
    fill it, so the next attack is never duplicated. The slices are the
    original audio.
    """
    if strength <= 0 or len(grid) == 0:
        return y, "timing left as played", []
    onsets = detect_onsets(y, sr)
    if len(onsets) < 2:
        return y, "not enough events to tighten", []
    max_shift = int(sr * max_shift_ms / 1000)
    fi, fo = int(0.002 * sr), int(0.02 * sr)
    starts = []
    for a in onsets:
        target = grid[np.argmin(np.abs(grid - a))]
        starts.append(int(a + np.clip((target - a) * strength, -max_shift, max_shift)))
    for k in range(1, len(starts)):
        starts[k] = max(starts[k], starts[k - 1] + fi + fo)
    out = np.zeros(len(y), dtype=np.float32)
    lead = min(onsets[0], starts[0])
    out[:lead] = y[:lead]
    moves = []
    for k, a in enumerate(onsets):
        last = k + 1 == len(onsets)
        b = len(y) if last else onsets[k + 1]
        st = starts[k]
        nxt = st + (b - a) if last else starts[k + 1]
        want = max(1, nxt - st + (0 if last else fo))
        seg = y[a:b].astype(np.float32).copy()
        if want > len(seg):                      # stretch the decay to fill the gap
            ext = want - len(seg)
            filler = y[max(a, b - ext - fo):b].astype(np.float32)
            joined = np.zeros(want, dtype=np.float32)
            joined[:len(seg)] = seg
            j0 = max(0, len(seg) - fo)
            n = min(fo, len(seg) - j0)
            joined[j0:j0 + n] *= 1 - np.arange(n) / fo
            m = min(len(filler), want - j0)
            ramp = np.minimum(np.arange(m) / fo, 1.0)
            joined[j0:j0 + m] += filler[:m] * ramp
            seg = joined
        else:
            seg = seg[:want]
        n = min(fi, len(seg)); seg[:n] *= np.arange(n) / max(fi, 1)
        if not last:
            n = min(fo, len(seg)); seg[len(seg) - n:] *= (np.arange(n) / fo)[::-1]
        s0 = max(st, 0)
        e0 = min(st + len(seg), len(out))
        out[s0:e0] += seg[s0 - st:e0 - st]
        moves.append(round((st - a) / sr * 1000, 1))
    avg = float(np.mean(np.abs(moves)))
    return out, f"moved {len(moves)} events towards the beat grid (avg {avg:.0f} ms, strength {strength:.0%})", moves


def correct_tuning(y, sr, key, strength, min_cents=8):
    """Pull each sung note towards the nearest note in the song's key.

    Re-pitches the singer's own note (formant-naive, prototype quality).
    """
    if strength <= 0:
        return y, "tuning left as sung", []
    scale = scale_pitch_classes(key)
    f0, voiced, hop = track_pitch(y, sr)
    notes = segment_notes(f0, voiced, hop, sr)
    out = y.copy()
    pad = int(0.015 * sr)
    changes = []
    for s, e, m in notes:
        steps = (nearest_scale_midi(m, scale) - m) * strength
        if abs(steps) * 100 < min_cents:
            continue
        a, b = max(s - pad, 0), min(e + pad, len(y))
        shifted = librosa.effects.pitch_shift(y[a:b], sr=sr, n_steps=float(steps))
        w = np.ones(b - a, dtype=np.float32)
        r = min(pad, (b - a) // 2)
        if r > 0:
            w[:r] = np.linspace(0, 1, r)
            w[-r:] = np.linspace(1, 0, r)
        out[a:b] = out[a:b] * (1 - w) + shifted * w
        changes.append(round(steps * 100))
    msg = (f"corrected {len(changes)} of {len(notes)} notes towards {key['tonic']} {key['mode']} "
           f"(strength {strength:.0%})") if notes else "no sung notes detected"
    return out, msg, changes
