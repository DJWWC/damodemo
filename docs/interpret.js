// Plain-English request -> knob changes. Offline, free, no AI.
//
// Understands:
//  - qualities you want more of ("warmer", "brighter") and problems to fix
//    ("muddy", "nasal", "harsh")
//  - modifiers: "less", "not so", "too" (inverts a quality), "slightly",
//    "a bit" (half step), "much", "a lot", "way" (bigger step)
//  - removal: "no reverb", "remove the compression", "reset"
//  - character words that move several knobs ("vintage", "dreamy", "lo-fi")
//  - which layer: names or types, "and"/"," lists, "everything"
//  - things it can't do yet, and things it never will (adding new parts)
//
// Every change is a knob move on the user's own audio; nothing is generated.

import { PARAMS, clamp } from "./settings.js";

// Bump when the vocabulary or rules change, and add a line to HISTORY.
// PROMPT_DICTIONARY.md is generated from this file: node tools/build_dictionary.mjs
export const INTERPRETER_VERSION = "2";
export const HISTORY = [
  { version: "1", date: "2026-11-24", summary: "Keyword rules only: 16 phrase groups (warmer, brighter, darker, less harsh, more present, punchier, more dynamic, tighter, looser, more reverb, drier, less noise, grit, left, right, thinner/cleaner). No modifiers: “less warm” made it warmer." },
  { version: "2", date: "2026-11-24", summary: "Smarter interpreter: problem words (muddy, nasal, boomy, muffled, distant…), modifiers (less, too, not so, slightly, a lot), character words (vintage, dreamy, lo-fi, telephone…), removal (no reverb, mono, reset), level and width, layer lists (“guitar and vocal”), and explanations for requests it can't do." },
];

export const LABEL = {
  denoise: "noise clean-up", timing_strength: "timing correction", hpf_hz: "low cut", warmth_db: "body (200 Hz)",
  mud_db: "boxiness (350 Hz)", nasal_db: "nasal range (1 kHz)", presence_db: "presence (3 kHz)",
  harshness_db: "harshness (6.5 kHz)", air_db: "air (10 kHz)", comp_threshold_db: "compression threshold",
  comp_ratio: "compression ratio", saturation_db: "saturation", reverb_mix: "reverb", reverb_size: "room size",
  pan: "pan", width: "stereo width", level_db: "level",
};
const UNIT = { hpf_hz: " Hz", warmth_db: " dB", mud_db: " dB", nasal_db: " dB", presence_db: " dB", harshness_db: " dB",
  air_db: " dB", comp_threshold_db: " dB", saturation_db: " dB", level_db: " dB" };

// kind: "q" = quality (more of it is the goal; "less"/"too" inverts)
//       "p" = problem (mentioning it means fix it; "more"/"add" inverts)
//       "m" = character macro (behaves like a quality)
// Order matters only for overlapping words: earlier entries claim the text first.
export const VOCAB = [
  // ---- character macros
  { kind: "m", name: "vintage", re: /vintage|retro|old[- ]school|old[- ]fashioned|classic/, ch: [["saturation_db", 3], ["air_db", -2], ["warmth_db", 1.5]] },
  { kind: "m", name: "dreamy", re: /dream(y|ier)|ethereal|wash(y|ed out)|floaty|atmospheric|ambient/, ch: [["reverb_mix", 0.15], ["reverb_size", 0.3], ["air_db", 1.5], ["width", 0.3]] },
  { kind: "m", name: "aggressive", re: /aggressive|angry|hard[- ]hitting|ferocious|in[- ]your[- ]face|heavy/, ch: [["comp_ratio", 2], ["comp_threshold_db", -6], ["presence_db", 2], ["saturation_db", 3], ["reverb_mix", -0.06]] },
  { kind: "m", name: "lush", re: /lush|luxurious|velvet(y)?|silky|plush/, ch: [["reverb_mix", 0.08], ["warmth_db", 1.5], ["width", 0.2], ["air_db", 1], ["harshness_db", -1.5]] },
  { kind: "m", name: "raw", re: /\braw\b|unprocessed|honest|stripped[- ]back|untouched|organic/, ch: [["timing_strength", -0.3], ["comp_ratio", -1], ["reverb_mix", -0.06], ["saturation_db", -2]] },
  { kind: "m", name: "lo-fi", re: /lo[- ]?fi|low[- ]fi|cassette|bedroom tape|degraded/, ch: [["air_db", -3], ["saturation_db", 4], ["hpf_hz", 60], ["presence_db", -1]] },
  { kind: "m", name: "polished", re: /radio[- ]ready|polished|commercial|professional|\bpro\b|release[- ]ready|slick|finished/, ch: [["comp_ratio", 1.5], ["comp_threshold_db", -4], ["presence_db", 1.5], ["air_db", 1.5], ["timing_strength", 0.2]] },
  { show: "telephone · phone · megaphone · walkie-talkie · radio effect · AM radio · like / through a (old / cheap) radio · old radio · transistor", kind: "m", name: "telephone", re: /telephone|phone|megaphone|walkie[- ]talkie|radio effect|am radio|(like|through) an? (old |cheap )?radio|old radio|transistor/, ch: [["hpf_hz", 250], ["air_db", -6], ["nasal_db", 3], ["presence_db", 2], ["warmth_db", -4]] },
  { kind: "m", name: "cosy", re: /cos(y|ier)|coz(y|ier)|campfire|fireside|living[- ]room|late[- ]night/, ch: [["warmth_db", 1.5], ["air_db", -1], ["reverb_mix", -0.05], ["harshness_db", -1]] },
  { kind: "m", name: "epic", re: /\bepic\b|huge|massive|cinematic|anthemic|stadium|arena|enormous/, ch: [["reverb_mix", 0.1], ["reverb_size", 0.25], ["width", 0.3], ["warmth_db", 1], ["comp_ratio", 1]] },

  // ---- problems (fix them)
  { kind: "p", name: "harsh", re: /harsh(ness)?|sibilan\w*|ess(y|ey)\b|sizzl\w*|spitty|piercing|shrill|brittle|fizzy|ear[- ]?ache|grating|sharp/, ch: [["harshness_db", -3], ["air_db", -0.5]] },
  { kind: "p", name: "muddy", re: /mud(dy|diness)?|murky|cloudy|woolly|wooly|congested|box(y|iness)|cardboard/, ch: [["mud_db", -2.5]] },
  { kind: "p", name: "boomy", re: /boom(y|iness)?|rumbl\w*|bloated|tubby|bass[- ]heavy|too much (low|bass|bottom)/, ch: [["warmth_db", -2], ["hpf_hz", 30]] },
  { kind: "p", name: "nasal", re: /nasal|nasally|honk(y)?|hollow|through (the|your) nose|cupped/, ch: [["nasal_db", -3]] },
  { kind: "p", name: "tinny", re: /tinny|cheap[- ]sounding|small[- ]sounding|plasticky|toy/, ch: [["warmth_db", 2], ["presence_db", -1], ["harshness_db", -1]] },
  { kind: "p", name: "thin", re: /\bthin\b|weak|anaemic|anemic|lacks body|no body|wimpy|feeble/, ch: [["warmth_db", 2], ["mud_db", 0.5]] },
  { kind: "p", name: "muffled", re: /muffl\w*|\bdull\b|blanket|veiled|smothered|lifeless|flat[- ]sounding|under a pillow|closed[- ]in/, ch: [["presence_db", 2], ["air_db", 2], ["mud_db", -1]] },
  { show: "distant · far away · far back · too far · buried · lost in · hidden · drowned / drowning · behind the · can't hear", kind: "p", name: "distant", re: /distant|far away|far back|too far|buried|lost in|hidden|drown\w*|behind the|can'?t hear/, ch: [["level_db", 2], ["presence_db", 1.5], ["reverb_mix", -0.05]] },
  { kind: "p", name: "overpowering", re: /overpower\w*|dominat\w*|too prominent|on top of everything|sticks out|swamp\w*/, ch: [["level_db", -2], ["presence_db", -1]] },
  { kind: "p", name: "sterile", re: /sterile|clinical|\bcold\b|too digital|soulless|robotic/, ch: [["saturation_db", 2], ["warmth_db", 1.5]] },
  { kind: "p", name: "sloppy", re: /sloppy|out of time|off (the )?beat|messy|rush(ed|ing)|drag(ged|ging|s)|uneven timing|timing is off|not in time/, ch: [["timing_strength", 0.3]] },
  { kind: "p", name: "squashed", re: /squash(ed|y)|over[- ]?compress\w*|pumping|no dynamics|flat dynamics|choked/, ch: [["comp_ratio", -1.5], ["comp_threshold_db", 4]] },
  { kind: "p", name: "noisy", re: /hiss(y)?|nois(e|y)|\bhum\b|buzz(y|ing)?|background noise|room noise|fan noise|static/, ch: [["denoise", 0.25]] },
  { kind: "p", name: "harsh-distorted", re: /distort(ed|ing)|fuzzy|crackl\w*|clipping|overdriven/, ch: [["saturation_db", -3], ["harshness_db", -1]] },
  { show: "washed-out · swimming · reverb soup · too wet · too much reverb / echo · cavernous · bathroom", kind: "p", name: "too reverby", re: /washed[- ]out|swimming|reverb(y)? soup|too (much )?(reverb|echo|wet)|cavernous|bathroom/, ch: [["reverb_mix", -0.1], ["reverb_size", -0.15]] },

  // ---- qualities (more of)
  { kind: "q", name: "warm", re: /warm(er|th)?|full(er|ness)?|thick(er)?|rich(er|ness)?|body|round(er)?|meaty|beefy/, ch: [["warmth_db", 2], ["air_db", -1]] },
  { kind: "q", name: "bright", re: /bright(er|ness)?|sparkl\w*|\bair(y|ier)?\b|shimmer\w*|crisp(er|y|ness)?|sheen|glossy|open[- ]sounding/, ch: [["air_db", 2], ["presence_db", 1]] },
  { kind: "q", name: "dark", re: /dark(er|ness)?|mellow(er)?|smooth(er)?|soft[- ]sounding|rounded off|less bite/, ch: [["air_db", -2], ["presence_db", -1], ["harshness_db", -1]] },
  { kind: "q", name: "loud", re: /loud(er|ness)?|turn(ed)? (it |this |them )?up|bring (it |this |them )?up|boost(ed)?|more volume|volume up|up in the mix|push (it |this )?forward|stand out/, ch: [["level_db", 2]] },
  { kind: "q", name: "quiet", re: /quiet(er)?|turn(ed)? (it |this |them )?down|bring (it |this |them )?down|volume down|down in the mix|sit(s)? back|push (it |this )?back|tuck(ed)? (it )?in|background|softer/, ch: [["level_db", -2]] },
  { kind: "q", name: "present", re: /present|presence|forward|up ?front|cut(s)? through|clear(er)?|clarity|defin(ed|ition)|articulate|intelligible|bite|edge/, ch: [["presence_db", 2], ["mud_db", -1]] },
  { kind: "q", name: "denoise", re: /de-?nois\w*|clean up the noise|noise reduction/, ch: [["denoise", 0.25]] },
  { kind: "q", name: "clean", re: /clean(er)?|tid(y|ier)|tighter low end|focused/, ch: [["mud_db", -2], ["warmth_db", -0.5], ["denoise", 0.1]] },
  { kind: "q", name: "punchy", re: /punch(y|ier)?|tighter dynamics|even(er)?|controlled|consistent|glue(d)?|compress(ed|ion)?|solid/, ch: [["comp_ratio", 1.5], ["comp_threshold_db", -4]] },
  { kind: "q", name: "dynamic", re: /dynamic|breath(e|y|ier)|open(s)? up|natural dynamics|room to breathe|more life/, ch: [["comp_ratio", -1.5], ["comp_threshold_db", 4]] },
  { kind: "q", name: "tight", re: /\btight(er|en)?\b|in time|on (the )?beat|on time|quantis\w*|quantiz\w*|locked( in)?|on the grid/, ch: [["timing_strength", 0.3]] },
  { kind: "q", name: "loose", re: /\bloose(r)?\b|human|natural feel|as played|groov\w*|laid[- ]back|swing/, ch: [["timing_strength", -0.3]] },
  { kind: "q", name: "reverb", re: /reverb|\bverb\b|spacious|space|roomy|\broom\b|\bhall\b|ambience|\bwet(ter)?\b|depth|3d/, ch: [["reverb_mix", 0.08], ["reverb_size", 0.15]] },
  { kind: "q", name: "dry", re: /\bdr(y|ier|yer)\b|intimate|\bclose(r)?\b|close[- ]mic\w*|upfront and dry|in the room with/, ch: [["reverb_mix", -0.08]] },
  { kind: "q", name: "wide", re: /wid(er|en|th|e)|stereo|spread|panoramic/, ch: [["width", 0.3]] },
  { kind: "q", name: "narrow", re: /narrow(er)?|centred|centered|focus(ed)? in the middle/, ch: [["width", -0.3]] },
  { kind: "q", name: "gritty", re: /grit(ty|tier)?|driv(e|en)|saturat\w*|analog(ue)?|\btape\b|valve|\btube\b|crunch(y)?|dirt(y|ier)|warm distortion/, ch: [["saturation_db", 3]] },
  { kind: "q", name: "left", re: /\bleft\b/, ch: [["pan", -0.3]] },
  { kind: "q", name: "right", re: /\bright\b/, ch: [["pan", 0.3]] },
];

// set an absolute value
export const ABSOLUTE = [
  { show: "no / remove / kill / without / turn off / get rid of / lose / drop + (the / any / all) reverb, verb, room, space, ambience", re: /(no|remove|kill|without|zero|turn off|get rid of|switch off|lose|drop)( all)?( the| any)? (reverb|verb|room|space|ambience)/, set: [["reverb_mix", 0]], say: "reverb off" },
  { show: "no / remove / without / turn off / bypass / lose / drop + (the / any) compression, compressor", re: /(no|remove|without|turn off|switch off|bypass|lose|drop)( the| any)? (compression|compressor)/, set: [["comp_ratio", 1]], say: "compression off" },
  { show: "no / remove / turn off + timing (correction), quantise · leave the timing · don't fix / touch / change the timing", re: /(no|remove|without|turn off|switch off|lose|drop)( the| any)? (timing( correction)?|quantis\w*|quantiz\w*)|leave the timing|don'?t (fix|touch|change) the timing/, set: [["timing_strength", 0]], say: "timing correction off" },
  { show: "no / remove / without / turn off + saturation, drive, distortion, grit", re: /(no|remove|without|turn off|lose|drop)( the| any)? (saturation|drive|distortion|grit)/, set: [["saturation_db", 0]], say: "saturation off" },
  { show: "no / remove / turn off + noise reduction, noise removal, denoise", re: /(no|remove|without|turn off)( the| any)? (noise (reduction|removal)|denois\w*)/, set: [["denoise", 0]], say: "noise clean-up off" },
  { re: /\bmono\b/, set: [["width", 0]], say: "mono (no width)" },
  { show: "centre · center · centred · centered · middle · pan(ned) centre", re: /(pan(ned)? )?(cent(er|re)(d)?|middle)(?! of)/, set: [["pan", 0]], say: "panned centre" },
  { re: /hard left|fully left|all the way left/, set: [["pan", -1]], say: "panned hard left" },
  { re: /hard right|fully right|all the way right/, set: [["pan", 1]], say: "panned hard right" },
];

// things the tool can't do (yet, or ever)
const ARTIST = "Sounding like a particular artist needs the Claude version (see DEVELOPMENT.md). For now, describe the sound instead: warmer, drier, brighter…";
export const UNSUPPORTED = [
  { re: /8[- ]?bit|16[- ]?bit|bit[- ]?crush\w*|chiptune|video game|nintendo|retro game|arcade/, say: "“8-bit”/bitcrush needs a bitcrusher effect, which isn't available yet." },
  { re: /auto[- ]?tune|pitch[- ]correct\w*|out of tune|off[- ]key|flat notes|sharp notes|\bin tune\b|tuning|pitchy/, say: "Vocal tuning isn't in the browser version yet (the Python version has it)." },
  { re: /\bdelay\b|\becho(es|ey)?\b|slap[- ]?back|ping[- ]pong/, say: "Delay/echo isn't available yet. Try “more reverb” for space." },
  { re: /chorus effect|flang\w*|phas(er|ing)|tremolo|vibrato|wah|auto[- ]?pan|rotary|leslie/, say: "Modulation effects (chorus, flanger, phaser, tremolo) aren't available yet." },
  { show: "in / during / on / for the chorus, verse, bridge, intro, outro, middle eight, drop, hook, start, end · first verse · second verse", re: /\b(in|during|on|for) the (chorus|verse|bridge|intro|outro|middle eight|drop|hook|end|start|beginning)\b|\bsecond verse\b|\bfirst verse\b/, say: "Changes apply to the whole song. Section-by-section edits aren't supported yet." },
  { re: /faster|slower|speed (it )?up|slow (it )?down|tempo|\bbpm\b|half[- ]time|double[- ]time/, say: "Changing the tempo isn't supported. LayerPolish keeps your performance at its own speed." },
  { re: /transpose|change (the )?key|key change|pitch (it )?(up|down)|semitone|octave/, say: "Changing key or pitch isn't supported." },
  { show: "add + drums, beat, bassline, harmony, backing, strings, piano, synth, pad, choir, instrument, vocals, percussion, claps · harmonise · double-track · backing vocals · generate · write · compose · sing", re: /\badd\b.*\b(drums?|beat|bass ?line|harmon\w*|backing|strings|piano|synth|pad|choir|instrument|vocals?|percussion|claps?)\b|harmoni[sz]e|double[- ]?track|backing vocals?|\bgenerate\b|\bwrite\b|\bcompose\b|\bsing\b/, say: "LayerPolish only edits what you recorded, so it won't add or generate new parts." },
  { cs: true, show: "sound(s) like / in the style of / like + a capitalised name (e.g. Like Adele, sounds like Bon Iver)", re: /\b(?:[Ss]ound(?:s|ing)? like|[Ii]n the style of|[Ss]tyle of|[Ll]ike)\s+(?:[A-Z][\w'’-]+)(?:\s+[A-Z][\w'’-]+)*/, say: ARTIST },
  { show: "sound(s) like / in the style of / like + a known artist typed in lower case (ed sheeran, taylor swift, adele, billie eilish, coldplay, the beatles, oasis, radiohead, john mayer, bon iver, phoebe bridgers, nirvana, queen)", re: /\b(sound(s|ing)? like|in the style of|style of|like)\s+(ed sheeran|taylor swift|adele|billie eilish|coldplay|the beatles|oasis|radiohead|john mayer|bon iver|phoebe bridgers|nirvana|queen)\b/, say: ARTIST },
];

export const INVERT_Q = /\b(less|not (so|as|too)|reduce|lower|cut( back)?( the)?|take (away|out)|decrease|tone down|too|fewer|minus|without as much|turn down the)\b/;
export const INVERT_P = /\b(more|add|extra|increase|boost)\b/;
export const SMALL = /\b(slightly|a (little )?bit|a little|a touch|a tad|subtly|gently|marginally|just a)\b/;
export const BIG = /\b(much|a lot|lots|way|really|very|heaps|massively|loads|super|seriously|hugely|drastically|significantly|extremely|tons)\b/;
export const RESET = /\b(reset|start over|start again|undo everything|back to default|defaults?)\b/;
export const EVERYTHING = /\b(everything|all (the )?(layers|tracks)|whole (mix|song|track)|the mix|overall|all of it)\b/;

/** Words in the few words before position `at`. */
function before(text, at, words = 4) {
  return text.slice(0, at).split(/\s+/).filter(Boolean).slice(-words).join(" ");
}

function fmtVal(param, v) {
  if (param === "reverb_mix" || param === "denoise" || param === "timing_strength" || param === "width") return `${Math.round(v * 100)}%`;
  if (param === "comp_ratio") return `${v.toFixed(1)}:1`;
  if (param === "pan") return v === 0 ? "centre" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "L" : "R"}`;
  return `${+v.toFixed(1)}${UNIT[param] || ""}`;
}

/**
 * prompt: user's text. layers: {name: {type}}. settings: {name: settings} (mutated).
 * baseline: {name: settings} used by "reset".
 * Returns { changes: [{layer, param, from, to, because, text}], notes: [string], understood: [string] }
 */
export function interpret(prompt, layers, settings, baseline = {}) {
  const changes = [], notes = [], understood = [];
  const names = Object.keys(settings);
  const layerMatch = (frag) => names.filter((n) => {
    const t = layers[n].type, f = frag.toLowerCase();
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${esc(n.toLowerCase().replace(/_/g, " "))}s?\\b|\\b${esc(n.toLowerCase())}s?\\b`).test(f)
      || new RegExp(`\\b${esc(t.replace("_", " "))}s?\\b`).test(f)
      || new RegExp(`\\b${esc(t.split("_").pop())}s?\\b`).test(f)
      || (t === "vocal" && /\b(vox|voice|singing|vocals?|singer)\b/.test(f));
  });

  const apply = (targets, param, newValFn, because) => {
    for (const layer of targets) {
      if (param === "timing_strength" && layers[layer].type === "vocal") continue;   // vocals get no timing correction
      const from = settings[layer][param], to = clamp(param, newValFn(from));
      if (Math.abs(to - from) < 1e-9) continue;
      settings[layer][param] = to;
      const prev = changes.find((c) => c.layer === layer && c.param === param);
      if (prev) { prev.to = +to.toFixed(3); prev.because += `, ${because}`; }
      else changes.push({ layer, param, from: +from.toFixed(3), to: +to.toFixed(3), because });
    }
  };

  // clauses: ; newline or full stop. fragments inside: , and but then
  const clauses = prompt.split(/[;\n]|\.\s/).map((c) => c.trim()).filter(Boolean);
  for (const clause of clauses) {
    let current = null, pending = [];
    const frags = clause.split(/,|\band\b|\bbut\b|\bthen\b|\bplus\b|\balso\b/i).map((f) => f.trim()).filter(Boolean);
    // "warmer and brighter vocal": earlier fragments borrow the layer named at the end
    const firstNamed = frags.findIndex((f) => layerMatch(f.toLowerCase()).length);
    let lookahead = null;
    if (firstNamed > 0) {
      const f = frags[firstNamed].toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
      const found = layerMatch(f), lastWord = f.split(/\s+/).pop();
      if (found.some((n) => layerMatch(lastWord).includes(n))) lookahead = found;
    }
    for (const fragRaw of frags) {
      const frag = fragRaw.toLowerCase();
      const found = layerMatch(frag);
      let targets;
      if (EVERYTHING.test(frag)) targets = names;
      else if (found.length) targets = [...new Set([...pending, ...found])];
      else targets = current || lookahead || names;

      const claimed = [];   // character spans already used
      const free = (a, b) => !claimed.some(([x, y]) => a < y && b > x);
      const claim = (a, b) => claimed.push([a, b]);
      let matchedSomething = false;

      if (RESET.test(frag)) {
        for (const layer of targets) if (baseline[layer]) {
          for (const p of Object.keys(PARAMS)) apply([layer], p, () => baseline[layer][p], "reset");
        }
        understood.push(`reset ${targets.join(", ")} to the preset`);
        matchedSomething = true;
      }
      for (const u of UNSUPPORTED) {
        const m = (u.cs ? u.re : new RegExp(u.re.source, "i")).exec(fragRaw);
        if (m && free(m.index, m.index + m[0].length)) { if (!notes.includes(u.say)) notes.push(u.say); claim(m.index, m.index + m[0].length); matchedSomething = true; }
      }
      for (const a of ABSOLUTE) {
        const m = a.re.exec(frag);
        if (m && free(m.index, m.index + m[0].length)) {
          claim(m.index, m.index + m[0].length);
          for (const [p, v] of a.set) apply(targets, p, () => v, `“${m[0]}”`);
          understood.push(`${targets.join(", ")}: ${a.say}`);
          matchedSomething = true;
        }
      }
      for (const v of VOCAB) {
        const re = new RegExp(v.re.source, "g");
        let m;
        while ((m = re.exec(frag))) {
          const a = m.index, b = a + m[0].length;
          if (!free(a, b) || !m[0]) continue;
          claim(a, b);
          const pre = before(frag, a);
          let dir = 1;
          if (v.kind === "p" ? INVERT_P.test(pre) : INVERT_Q.test(pre)) dir = -1;
          // "the vocal is quiet" describes the problem: do the opposite
          if (dir === 1 && (v.name === "loud" || v.name === "quiet") && /\b(is|sounds?|feels?|seems?|are|'s|its|it's|bit|little|kind of|quite|rather)\b/.test(pre)
              && !/\b(make|more|turn|bring|push|get)\b/.test(pre) && !/(er|up|down|forward|back)\b/.test(m[0])) dir = -dir;
          // "less harsh" / "too muddy" on a problem word = fix it (dir stays 1)
          let scale = 1;
          if (SMALL.test(pre)) scale = 0.5;
          else if (BIG.test(pre)) scale = 1.8;
          const phrase = (pre.match(/\b(less|not so|not as|too|much|a lot|slightly|a bit|a little|way|very|really|more)\b.*$/)?.[0] ?? "") ;
          const label = `“${(phrase ? phrase + " " : "") + m[0]}”`.replace(/\s+/g, " ");
          for (const [p, d] of v.ch) apply(targets, p, (x) => x + d * dir * scale, label);
          understood.push(`${targets.join(", ")}: ${dir < 0 ? (v.kind === "p" ? "more " : "less ") : ""}${v.name}${scale !== 1 ? (scale < 1 ? " (a little)" : " (a lot)") : ""}${v.kind === "p" && dir > 0 ? " → fix" : ""}`);
          matchedSomething = true;
        }
      }
      // bare "up"/"down" after a layer name: "vocal up", "guitar down 3 dB"
      if (!matchedSomething && found.length) {
        const m = frag.match(/\b(up|down)\b(?:\s*(\d+(?:\.\d+)?)\s*(db)?)?/);
        if (m) {
          const amt = m[2] ? +m[2] : 2;
          apply(targets, "level_db", (x) => x + (m[1] === "up" ? amt : -amt), `“${m[0]}”`);
          understood.push(`${targets.join(", ")}: level ${m[1]} ${amt} dB`);
          matchedSomething = true;
        }
      }
      if (found.length && !matchedSomething) pending = targets;   // "guitar and vocal brighter"
      else pending = [];
      if (found.length || EVERYTHING.test(frag)) current = targets;
    }
  }
  for (const c of changes) c.text = `${c.layer}: ${LABEL[c.param]} ${fmtVal(c.param, c.from)} → ${fmtVal(c.param, c.to)}  (${c.because})`;
  if (!changes.length && !notes.length) {
    notes.push("Nothing in that matched. Try describing the sound: warmer, brighter, less muddy, less nasal, drier, punchier, tighter, wider, louder, vintage, dreamy, lo-fi…");
  }
  return { changes, notes, understood };
}

/** Compatibility wrapper used by older code/tests. */
export function applyPrompt(prompt, layers, settings, baseline) {
  return interpret(prompt, layers, settings, baseline).changes;
}
