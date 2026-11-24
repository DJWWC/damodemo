"""Per-sound-type processing chains and presets.

Each layer has a small set of named, range-limited parameters. These are
the only 'knobs' that presets, the user and the AI assistant can turn.
"""
import copy
import numpy as np
from pedalboard import (Pedalboard, HighpassFilter, LowShelfFilter, HighShelfFilter,
                        PeakFilter, Compressor, Reverb, Distortion, Gain)

# name: (min, max, description)
PARAMS = {
    "denoise":          (0.0, 1.0, "noise reduction strength"),
    "timing_strength":  (0.0, 1.0, "how far events are pulled to the beat grid (0 = as played)"),
    "tuning_strength":  (0.0, 1.0, "how far sung notes are pulled into key (0 = as sung)"),
    "hpf_hz":           (20, 300, "high-pass filter: removes rumble below this frequency"),
    "warmth_db":        (-6, 6, "low shelf at 200 Hz: body/warmth"),
    "mud_db":           (-8, 3, "bell at 350 Hz: boxiness/mud (negative = cleaner)"),
    "nasal_db":         (-8, 3, "bell at 1 kHz: nasal/honky range (negative = less nasal)"),
    "presence_db":      (-6, 6, "bell at 3 kHz: clarity/forwardness"),
    "harshness_db":     (-8, 2, "bell at 6.5 kHz: harshness/sibilance (negative = smoother)"),
    "air_db":           (-6, 6, "high shelf at 10 kHz: sparkle/air"),
    "comp_threshold_db": (-40, 0, "compressor threshold"),
    "comp_ratio":       (1.0, 8.0, "compressor ratio (higher = more even/punchy)"),
    "saturation_db":    (0, 12, "gentle drive for analogue-style warmth"),
    "reverb_mix":       (0.0, 0.5, "reverb amount"),
    "reverb_size":      (0.0, 1.0, "reverb room size"),
    "pan":              (-1.0, 1.0, "stereo position (-1 left, 1 right)"),
    "width":            (0.0, 1.0, "stereo width (0 = mono point, 1 = wide)"),
    "level_db":         (-12, 12, "level in the mix, relative to the automatic balance"),
}

SOUND_TYPES = {
    "vocal": dict(denoise=0.6, timing_strength=0.0, tuning_strength=0.6, hpf_hz=90, warmth_db=1.0,
                  mud_db=-2.5, presence_db=2.5, harshness_db=-2.0, air_db=2.0, comp_threshold_db=-22,
                  comp_ratio=3.5, saturation_db=2.0, reverb_mix=0.18, reverb_size=0.45, pan=0.0, nasal_db=0.0, width=0.0, level_db=0.0),
    "acoustic_guitar": dict(denoise=0.5, timing_strength=0.6, tuning_strength=0.0, hpf_hz=80, warmth_db=0.0,
                            mud_db=-3.5, presence_db=1.0, harshness_db=-1.0, air_db=2.5, comp_threshold_db=-20,
                            comp_ratio=2.5, saturation_db=0.0, reverb_mix=0.12, reverb_size=0.4, pan=0.0, nasal_db=0.0, width=0.3, level_db=0.0),
    "electric_guitar": dict(denoise=0.4, timing_strength=0.6, tuning_strength=0.0, hpf_hz=90, warmth_db=0.5,
                            mud_db=-2.0, presence_db=1.5, harshness_db=-2.0, air_db=0.0, comp_threshold_db=-18,
                            comp_ratio=2.0, saturation_db=3.0, reverb_mix=0.1, reverb_size=0.35, pan=0.0, nasal_db=0.0, width=0.3, level_db=0.0),
    "bass": dict(denoise=0.3, timing_strength=0.5, tuning_strength=0.0, hpf_hz=35, warmth_db=2.0,
                 mud_db=-1.5, presence_db=1.0, harshness_db=0.0, air_db=-2.0, comp_threshold_db=-24,
                 comp_ratio=4.0, saturation_db=2.0, reverb_mix=0.0, reverb_size=0.2, pan=0.0, nasal_db=0.0, width=0.0, level_db=0.0),
}

# Style presets: offsets applied on top of the sound-type defaults
PRESETS = {
    "natural": {"timing_strength": -0.3, "tuning_strength": -0.3, "comp_ratio": -0.5, "reverb_mix": -0.05},
    "intimate_acoustic": {"reverb_mix": -0.08, "warmth_db": 1.5, "air_db": -0.5, "comp_ratio": 0.5},
    "radio_pop": {"timing_strength": 0.3, "tuning_strength": 0.3, "presence_db": 1.5, "air_db": 1.5,
                  "comp_ratio": 1.5, "comp_threshold_db": -4},
    "big_room": {"reverb_mix": 0.12, "reverb_size": 0.3, "air_db": 1.0},
    "lofi_warm": {"air_db": -3.0, "warmth_db": 2.0, "saturation_db": 4.0, "presence_db": -1.0},
}


def clamp(name, value):
    lo, hi, _ = PARAMS[name]
    return float(np.clip(value, lo, hi))


def default_settings(sound_type, preset=None):
    if sound_type not in SOUND_TYPES:
        raise ValueError(f"unknown sound type '{sound_type}'. Options: {', '.join(SOUND_TYPES)}")
    s = copy.deepcopy(SOUND_TYPES[sound_type])
    if preset:
        if preset not in PRESETS:
            raise ValueError(f"unknown preset '{preset}'. Options: {', '.join(PRESETS)}")
        for k, d in PRESETS[preset].items():
            s[k] = clamp(k, s[k] + d)
    return s


def build_board(s):
    fx = [HighpassFilter(cutoff_frequency_hz=s["hpf_hz"]),
          LowShelfFilter(cutoff_frequency_hz=200, gain_db=s["warmth_db"], q=0.7),
          PeakFilter(cutoff_frequency_hz=350, gain_db=s["mud_db"], q=1.0),
          PeakFilter(cutoff_frequency_hz=1000, gain_db=s.get("nasal_db", 0.0), q=1.2),
          PeakFilter(cutoff_frequency_hz=3000, gain_db=s["presence_db"], q=0.9),
          PeakFilter(cutoff_frequency_hz=6500, gain_db=s["harshness_db"], q=1.4),
          HighShelfFilter(cutoff_frequency_hz=10000, gain_db=s["air_db"], q=0.7),
          Compressor(threshold_db=s["comp_threshold_db"], ratio=s["comp_ratio"], attack_ms=8, release_ms=120)]
    if s["saturation_db"] > 0.1:
        fx += [Distortion(drive_db=s["saturation_db"]), Gain(gain_db=-s["saturation_db"] * 0.6)]
    if s["reverb_mix"] > 0.001:
        fx.append(Reverb(room_size=s["reverb_size"], wet_level=s["reverb_mix"],
                         dry_level=1.0 - s["reverb_mix"] * 0.5, damping=0.5, width=1.0))
    return Pedalboard(fx)


def apply_chain(y, sr, s):
    out = build_board(s)(y.astype(np.float32)[None, :], sr)[0]
    return out


def to_stereo(y, pan):
    """Constant-power pan of a mono layer."""
    angle = (pan + 1) * np.pi / 4
    return np.stack([y * np.cos(angle), y * np.sin(angle)])
