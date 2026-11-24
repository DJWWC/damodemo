// Sound types, presets, the parameter list (the only adjustable settings) and the
// plain-English prompt rules. Mirrors chain.py / assistant.py.

export const PARAMS = {
  denoise:           [0, 1, "noise reduction strength"],
  timing_strength:   [0, 1, "how far events are pulled to the beat grid (0 = as played)"],
  hpf_hz:            [20, 300, "high-pass filter: removes rumble below this frequency"],
  warmth_db:         [-6, 6, "low shelf at 200 Hz: body/warmth"],
  mud_db:            [-8, 3, "bell at 350 Hz: boxiness/mud (negative = cleaner)"],
  presence_db:       [-6, 6, "bell at 3 kHz: clarity/forwardness"],
  nasal_db:          [-8, 3, "bell at 1 kHz: nasal/honky range (negative = less nasal)"],
  harshness_db:      [-8, 2, "bell at 6.5 kHz: harshness/sibilance (negative = smoother)"],
  air_db:            [-6, 6, "high shelf at 10 kHz: sparkle/air"],
  comp_threshold_db: [-40, 0, "compressor threshold"],
  comp_ratio:        [1, 8, "compressor ratio (higher = more even/punchy)"],
  saturation_db:     [0, 12, "gentle drive for analogue-style warmth"],
  reverb_mix:        [0, 0.5, "reverb amount"],
  reverb_size:       [0, 1, "reverb room size"],
  pan:               [-1, 1, "stereo position (-1 left, 1 right)"],
  width:             [0, 1, "stereo width (0 = mono point, 1 = wide)"],
  level_db:          [-12, 12, "level in the mix, relative to the automatic balance"],
};

export const SOUND_TYPES = {
  vocal: { label: "Vocal", denoise: 0.6, timing_strength: 0, hpf_hz: 90, warmth_db: 1, mud_db: -2.5,
    presence_db: 2.5, harshness_db: -2, air_db: 2, comp_threshold_db: -22, comp_ratio: 3.5,
    saturation_db: 2, reverb_mix: 0.18, reverb_size: 0.45, pan: 0, nasal_db: 0, width: 0, level_db: 0 },
  acoustic_guitar: { label: "Acoustic guitar", denoise: 0.5, timing_strength: 0.6, hpf_hz: 80, warmth_db: 0,
    mud_db: -3.5, presence_db: 1, harshness_db: -1, air_db: 2.5, comp_threshold_db: -20, comp_ratio: 2.5,
    saturation_db: 0, reverb_mix: 0.12, reverb_size: 0.4, pan: 0, nasal_db: 0, width: 0.3, level_db: 0 },
  electric_guitar: { label: "Electric guitar", denoise: 0.4, timing_strength: 0.6, hpf_hz: 90, warmth_db: 0.5,
    mud_db: -2, presence_db: 1.5, harshness_db: -2, air_db: 0, comp_threshold_db: -18, comp_ratio: 2,
    saturation_db: 3, reverb_mix: 0.1, reverb_size: 0.35, pan: 0, nasal_db: 0, width: 0.3, level_db: 0 },
  bass: { label: "Bass", denoise: 0.3, timing_strength: 0.5, hpf_hz: 35, warmth_db: 2, mud_db: -1.5,
    presence_db: 1, harshness_db: 0, air_db: -2, comp_threshold_db: -24, comp_ratio: 4,
    saturation_db: 2, reverb_mix: 0, reverb_size: 0.2, pan: 0, nasal_db: 0, width: 0, level_db: 0 },
};

export const PRESETS = {
  none: { label: "No preset" },
  natural: { label: "Natural", timing_strength: -0.3, comp_ratio: -0.5, reverb_mix: -0.05 },
  intimate_acoustic: { label: "Intimate acoustic", reverb_mix: -0.08, warmth_db: 1.5, air_db: -0.5, comp_ratio: 0.5 },
  radio_pop: { label: "Radio pop", timing_strength: 0.3, presence_db: 1.5, air_db: 1.5, comp_ratio: 1.5, comp_threshold_db: -4 },
  big_room: { label: "Big room", reverb_mix: 0.12, reverb_size: 0.3, air_db: 1 },
  lofi_warm: { label: "Lo-fi warm", air_db: -3, warmth_db: 2, saturation_db: 4, presence_db: -1 },
};

// How the settings are grouped and named in the "Audio adjustments" panel (like a studio channel strip)
export const GROUPS = [
  ["Clean-up", ["denoise", "timing_strength"]],
  ["EQ (tone)", ["hpf_hz", "warmth_db", "mud_db", "nasal_db", "presence_db", "harshness_db", "air_db"]],
  ["Dynamics", ["comp_threshold_db", "comp_ratio"]],
  ["Effects", ["saturation_db", "reverb_mix", "reverb_size"]],
  ["Mix", ["level_db", "pan", "width"]],
];
export const LABELS = {
  denoise: ["Noise clean-up", "%"], timing_strength: ["Timing correction", "%"],
  hpf_hz: ["Low cut", "Hz"], warmth_db: ["Body · 200 Hz", "dB"], mud_db: ["Boxiness · 350 Hz", "dB"],
  nasal_db: ["Nasal · 1 kHz", "dB"], presence_db: ["Presence · 3 kHz", "dB"], harshness_db: ["Harshness · 6.5 kHz", "dB"],
  air_db: ["Air · 10 kHz", "dB"], comp_threshold_db: ["Compressor threshold", "dB"], comp_ratio: ["Compressor ratio", ":1"],
  saturation_db: ["Saturation (drive)", "dB"], reverb_mix: ["Reverb amount", "%"], reverb_size: ["Room size", "%"],
  level_db: ["Level", "dB"], pan: ["Pan", "pan"], width: ["Stereo width", "%"],
};
export function formatSetting(p, v) {
  const u = LABELS[p]?.[1];
  if (u === "%") return `${Math.round(v * 100)}%`;
  if (u === "Hz") return `${Math.round(v)} Hz`;
  if (u === ":1") return `${(+v).toFixed(1)}:1`;
  if (u === "pan") return Math.abs(v) < 0.025 ? "C" : `${Math.round(Math.abs(v) * 100)}${v < 0 ? "L" : "R"}`;
  if (u === "dB") return `${v > 0 ? "+" : ""}${(+v).toFixed(1)} dB`;
  return String(v);
}

export function clamp(name, v) {
  const [lo, hi] = PARAMS[name];
  return Math.min(hi, Math.max(lo, v));
}

export function defaultSettings(type, preset) {
  const s = {};
  for (const k of Object.keys(PARAMS)) s[k] = SOUND_TYPES[type][k];
  const p = PRESETS[preset] || {};
  for (const [k, d] of Object.entries(p)) if (k in PARAMS) s[k] = clamp(k, s[k] + d);
  return s;
}

export { interpret, applyPrompt } from "./interpret.js";
