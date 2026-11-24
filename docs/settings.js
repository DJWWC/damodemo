// Sound types, presets, the parameter list (the only "knobs") and the
// plain-English prompt rules. Mirrors chain.py / assistant.py.

export const PARAMS = {
  denoise:           [0, 1, "noise reduction strength"],
  timing_strength:   [0, 1, "how far events are pulled to the beat grid (0 = as played)"],
  hpf_hz:            [20, 300, "high-pass filter: removes rumble below this frequency"],
  warmth_db:         [-6, 6, "low shelf at 200 Hz: body/warmth"],
  mud_db:            [-8, 3, "bell at 350 Hz: boxiness/mud (negative = cleaner)"],
  presence_db:       [-6, 6, "bell at 3 kHz: clarity/forwardness"],
  harshness_db:      [-8, 2, "bell at 6.5 kHz: harshness/sibilance (negative = smoother)"],
  air_db:            [-6, 6, "high shelf at 10 kHz: sparkle/air"],
  comp_threshold_db: [-40, 0, "compressor threshold"],
  comp_ratio:        [1, 8, "compressor ratio (higher = more even/punchy)"],
  saturation_db:     [0, 12, "gentle drive for analogue-style warmth"],
  reverb_mix:        [0, 0.5, "reverb amount"],
  reverb_size:       [0, 1, "reverb room size"],
  pan:               [-1, 1, "stereo position (-1 left, 1 right)"],
};

export const SOUND_TYPES = {
  vocal: { label: "Vocal", denoise: 0.6, timing_strength: 0, hpf_hz: 90, warmth_db: 1, mud_db: -2.5,
    presence_db: 2.5, harshness_db: -2, air_db: 2, comp_threshold_db: -22, comp_ratio: 3.5,
    saturation_db: 2, reverb_mix: 0.18, reverb_size: 0.45, pan: 0 },
  acoustic_guitar: { label: "Acoustic guitar", denoise: 0.5, timing_strength: 0.6, hpf_hz: 80, warmth_db: 0,
    mud_db: -3.5, presence_db: 1, harshness_db: -1, air_db: 2.5, comp_threshold_db: -20, comp_ratio: 2.5,
    saturation_db: 0, reverb_mix: 0.12, reverb_size: 0.4, pan: 0 },
  electric_guitar: { label: "Electric guitar", denoise: 0.4, timing_strength: 0.6, hpf_hz: 90, warmth_db: 0.5,
    mud_db: -2, presence_db: 1.5, harshness_db: -2, air_db: 0, comp_threshold_db: -18, comp_ratio: 2,
    saturation_db: 3, reverb_mix: 0.1, reverb_size: 0.35, pan: 0 },
  bass: { label: "Bass", denoise: 0.3, timing_strength: 0.5, hpf_hz: 35, warmth_db: 2, mud_db: -1.5,
    presence_db: 1, harshness_db: 0, air_db: -2, comp_threshold_db: -24, comp_ratio: 4,
    saturation_db: 2, reverb_mix: 0, reverb_size: 0.2, pan: 0 },
};

export const PRESETS = {
  none: { label: "No preset" },
  natural: { label: "Natural", timing_strength: -0.3, comp_ratio: -0.5, reverb_mix: -0.05 },
  intimate_acoustic: { label: "Intimate acoustic", reverb_mix: -0.08, warmth_db: 1.5, air_db: -0.5, comp_ratio: 0.5 },
  radio_pop: { label: "Radio pop", timing_strength: 0.3, presence_db: 1.5, air_db: 1.5, comp_ratio: 1.5, comp_threshold_db: -4 },
  big_room: { label: "Big room", reverb_mix: 0.12, reverb_size: 0.3, air_db: 1 },
  lofi_warm: { label: "Lo-fi warm", air_db: -3, warmth_db: 2, saturation_db: 4, presence_db: -1 },
};

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

// phrase -> [[param, delta], ...]
const RULES = [
  [/warm(er)?|fuller|thicker/, [["warmth_db", 2], ["air_db", -1]]],
  [/thin(ner)?|less boomy|less muddy|cleaner|clearer/, [["mud_db", -2], ["warmth_db", -1]]],
  [/bright(er)?|sparkl|airy|more air/, [["air_db", 2], ["presence_db", 1]]],
  [/dark(er)?|duller|mellow/, [["air_db", -2], ["presence_db", -1]]],
  [/harsh|sibilan|smooth(er)?|less (sharp|shrill)/, [["harshness_db", -3]]],
  [/forward|upfront|cut through|more present/, [["presence_db", 2]]],
  [/punch(y|ier)?|tighter dynamics|more even|controlled/, [["comp_ratio", 1.5], ["comp_threshold_db", -4]]],
  [/more dynamic|less compress|breath(e|ier)|open up/, [["comp_ratio", -1.5], ["comp_threshold_db", 4]]],
  [/\btight(er)?\b|in time|on the beat|quantis|quantiz/, [["timing_strength", 0.3]]],
  [/loose(r)?|human|as played|natural feel/, [["timing_strength", -0.3]]],
  [/reverb|spacious|bigger room|wetter|more space/, [["reverb_mix", 0.08], ["reverb_size", 0.15]]],
  [/\bdry(er)?\b|\bdrier\b|intimate|\bclose\b|less reverb/, [["reverb_mix", -0.08]]],
  [/hiss|noisy|less noise/, [["denoise", 0.25]]],
  [/grit|drive|saturat|analog/, [["saturation_db", 3]]],
  [/\bleft\b/, [["pan", -0.3]]],
  [/\bright\b/, [["pan", 0.3]]],
];

/** layers: {name: {type}}, settings: {name: settingsObj}. Mutates settings, returns change log. */
export function applyPrompt(prompt, layers, settings) {
  const log = [];
  const clauses = prompt.split(/[;\n]/).map((c) => c.trim()).filter(Boolean);
  for (const clause of clauses) {
    const low = clause.toLowerCase();
    let targets = Object.keys(settings).filter((name) => {
      const n = name.toLowerCase();
      const t = layers[name].type;
      return low.includes(n) || low.includes(t.replace("_", " ")) || low.includes(t.split("_").pop());
    });
    if (!targets.length) targets = Object.keys(settings);
    for (const [re, changes] of RULES) {
      if (!re.test(low)) continue;
      for (const name of targets) {
        for (const [param, delta] of changes) {
          const from = settings[name][param];
          const to = clamp(param, from + delta);
          if (to !== from) {
            settings[name][param] = to;
            log.push({ layer: name, param, from: +from.toFixed(2), to: +to.toFixed(2) });
          }
        }
      }
    }
  }
  return log;
}
