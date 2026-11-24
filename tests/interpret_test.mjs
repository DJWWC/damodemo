import { defaultSettings } from "../docs/settings.js";
import { interpret } from "../docs/interpret.js";

const layers = { guitar: { type: "acoustic_guitar" }, vocal: { type: "vocal" }, bass: { type: "bass" } };
const fresh = () => Object.fromEntries(Object.entries(layers).map(([n, l]) => [n, defaultSettings(l.type, "none")]));
let fails = 0;
function t(prompt, expect = {}, show = true) {
  const s = fresh(), base = fresh();
  const r = interpret(prompt, layers, s, base);
  const delta = (l, p) => +(s[l][p] - base[l][p]).toFixed(3);
  const errs = [];
  for (const [key, cond] of Object.entries(expect)) {
    if (key === "note") { if (!r.notes.some((n) => n.includes(cond))) errs.push(`note "${cond}" missing`); continue; }
    if (key === "nochange") { if (r.changes.length) errs.push(`expected no change`); continue; }
    const [l, p] = key.split(".");
    const d = delta(l, p);
    if (cond === ">0" && !(d > 0)) errs.push(`${key} not up (${d})`);
    else if (cond === "<0" && !(d < 0)) errs.push(`${key} not down (${d})`);
    else if (cond === "=0" && d !== 0) errs.push(`${key} changed (${d})`);
    else if (typeof cond === "number" && Math.abs(s[l][p] - cond) > 1e-6) errs.push(`${key}=${s[l][p]} want ${cond}`);
  }
  if (errs.length) fails++;
  if (show || errs.length) {
    console.log(`${errs.length ? "FAIL" : "ok  "}  "${prompt}"`);
    r.changes.forEach((c) => console.log("        " + c.text));
    r.notes.forEach((n) => console.log("        note: " + n));
    errs.forEach((e) => console.log("        !! " + e));
  }
}
// basics + targeting
t("vocal: warmer", { "vocal.warmth_db": ">0", "guitar.warmth_db": "=0" });
t("warmer", { "vocal.warmth_db": ">0", "guitar.warmth_db": ">0" }, false);
t("guitar and vocal brighter", { "vocal.air_db": ">0", "guitar.air_db": ">0", "bass.air_db": "=0" });
t("vocal warmer, guitar tighter", { "vocal.warmth_db": ">0", "guitar.timing_strength": ">0", "guitar.warmth_db": "=0" });
t("make the voice a bit brighter and less harsh", { "vocal.air_db": ">0", "vocal.harshness_db": "<0", "guitar.air_db": "=0" });
// modifiers
t("vocal: less warm", { "vocal.warmth_db": "<0" });
t("guitar is too bright", { "guitar.air_db": "<0" });
t("vocal: slightly warmer", { "vocal.warmth_db": 2 }, false);           // base 1 + 2*0.5
t("vocal: much warmer", { "vocal.warmth_db": 4.6 }, false);              // base 1 + 2*1.8
t("too much reverb on the vocal", { "vocal.reverb_mix": "<0" });
t("vocal: no reverb", { "vocal.reverb_mix": 0 });
t("the vocal is too loud", { "vocal.level_db": "<0" });
t("vocal is a bit quiet", { "vocal.level_db": ">0" });
t("make the guitar quieter", { "guitar.level_db": "<0" }, false);
t("turn the guitar down", { "guitar.level_db": "<0" }, false);
t("warmer and brighter on the vocal", { "vocal.warmth_db": ">0", "guitar.warmth_db": "=0" }, false);
t("I can't hear the vocal", { "vocal.level_db": ">0" });
t("vocal up 3 db", { "vocal.level_db": 3 });
// problems
t("the vocal sounds nasal and a bit muddy", { "vocal.nasal_db": "<0", "vocal.mud_db": "<0" });
t("guitar sounds boomy and muffled", { "guitar.warmth_db": "<0", "guitar.hpf_hz": ">0", "guitar.presence_db": ">0" });
t("vocal feels distant and buried", { "vocal.level_db": ">0" });
t("guitar timing is sloppy", { "guitar.timing_strength": ">0" });
t("the bass is overpowering", { "bass.level_db": "<0" });
t("vocal is sibilant", { "vocal.harshness_db": "<0" });
t("there's hiss on the guitar", { "guitar.denoise": ">0" });
// character
t("make it more vintage", { "vocal.saturation_db": ">0", "guitar.saturation_db": ">0" });
t("guitar: dreamy and wide", { "guitar.reverb_mix": ">0", "guitar.width": ">0" });
t("vocal like a telephone", { "vocal.hpf_hz": ">0", "vocal.air_db": "<0" });
t("lo-fi", { "guitar.air_db": "<0", "vocal.saturation_db": ">0" }, false);
t("make the whole mix more polished", { "vocal.comp_ratio": ">0", "guitar.comp_ratio": ">0" });
t("raw and natural guitar", { "guitar.timing_strength": "<0", "vocal.comp_ratio": "=0", "bass.timing_strength": "=0" });
// absolute & reset
t("guitar: mono", { "guitar.width": 0 });
t("pan the guitar hard left", { "guitar.pan": -1 });
t("guitar: no timing correction", { "guitar.timing_strength": 0 });
// unsupported
t("make the guitar 8-bit", { note: "bitcrusher", nochange: true });
t("autotune the vocal", { note: "tuning", nochange: true });
t("add a delay to the vocal", { note: "Delay" });
t("more reverb in the chorus", { note: "whole song", "vocal.reverb_mix": ">0" });
t("add some drums", { note: "won't add" });
t("make it sound like Ed Sheeran", { note: "artist" });
t("make it sound like a radio", { "vocal.hpf_hz": ">0" }, false);
t("asdfgh", { note: "Nothing" });
// tricky
t("vocal: not so bright", { "vocal.air_db": "<0" });
t("guitar: less muddy", { "guitar.mud_db": "<0" });
t("vocal tighter", { nochange: true }, false);                          // vocals have no timing correction
t("reset the vocal", {}, false);
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
