// Generates PROMPT_DICTIONARY.md from docs/interpret.js so the list of phrases
// is always exactly what the interpreter understands.
//   node tools/build_dictionary.mjs > PROMPT_DICTIONARY.md
import * as I from "../docs/interpret.js";
import { PARAMS } from "../docs/settings.js";

// --- turn a regex into readable example phrases (best effort, capped)
function splitTop(s, sep = "|") {
  const out = []; let depth = 0, cur = "", cls = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { cur += c + s[++i]; continue; }
    if (cls) { if (c === "]") cls = false; cur += c; continue; }
    if (c === "[") { cls = true; cur += c; continue; }
    if (c === "(") depth++; if (c === ")") depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out;
}
function expand(src, cap = 6) {
  // returns list of strings for a regex fragment without top-level |
  let results = [""];
  let i = 0;
  const push = (alts, optional) => {
    let opts = optional ? ["", ...alts] : alts;
    const next = [];
    for (const r of results) for (const o of opts) next.push(r + o);
    results = next.slice(0, cap * 4);
  };
  while (i < src.length) {
    let c = src[i];
    if (c === "\\") {
      const e = src[i + 1]; i += 2;
      if (e === "b") continue;
      if (e === "w" || e === "d") { const q = src[i]; if (q === "*" || q === "+") i++; push(["…"], false); continue; }
      if (e === "s") { const q = src[i]; if (q === "*" || q === "+") i++; push([" "], false); continue; }
      push([e], src[i] === "?" ? (i++, true) : false); continue;
    }
    if (c === "^" || c === "$") { i++; continue; }
    if (c === "(") {
      let depth = 1, j = i + 1;
      while (depth) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === "(") depth++; if (src[j] === ")") depth--; j++; }
      let inner = src.slice(i + 1, j - 1);
      i = j;
      if (inner.startsWith("?!") || inner.startsWith("?=")) continue;
      if (inner.startsWith("?:")) inner = inner.slice(2);
      const alts = splitTop(inner).flatMap((a) => expand(a, cap));
      let opt = false;
      if (src[i] === "?") { opt = true; i++; } else if (src[i] === "*" || src[i] === "+") { i++; }
      push(alts, opt); continue;
    }
    if (c === "[") {
      const j = src.indexOf("]", i);
      const body = src.slice(i + 1, j); i = j + 1;
      let ch = body.includes("-") && body.includes(" ") ? "-" : body.replace(/\\/g, "")[0];
      if (body === "Ss" || body === "Ii" || body === "Ll") ch = body[1];
      let opt = false;
      if (src[i] === "?") { opt = true; i++; } else if (src[i] === "*" || src[i] === "+") { i++; }
      if (opt && ch === "-") { push(["-"], false); continue; }   // lo-fi rather than lofi
      push([ch], opt); continue;
    }
    if (src[i + 1] === "?") { push([c], true); i += 2; continue; }
    push([c], false); i++;
  }
  return [...new Set(results.filter((r) => r.trim()))];
}
function phrases(re, cap = 4) {
  return splitTop(re.source).map((alt) => {
    const ex = [...new Set(expand(alt).map((r) => r.replace(/\s+/g, " ").trim()).filter(Boolean))];
    return ex.length > cap ? ex.slice(0, cap).join(" / ") + " …" : ex.join(" / ");
  });
}
const sign = (d) => (d > 0 ? "+" : "−") + Math.abs(d);
const UNITS = { hpf_hz: " Hz", warmth_db: " dB", mud_db: " dB", nasal_db: " dB", presence_db: " dB", harshness_db: " dB", air_db: " dB",
  comp_threshold_db: " dB", saturation_db: " dB", level_db: " dB" };
const pct = new Set(["reverb_mix", "denoise", "timing_strength", "width"]);
function effect(ch) {
  return ch.map(([p, d]) => `${I.LABEL[p]} ${pct.has(p) ? sign(Math.round(d * 100)) + "%" : p === "pan" ? sign(Math.round(d * 100)) + "% (− = left)" : p === "comp_ratio" ? sign(d) + " ratio" : sign(d) + (UNITS[p] || "")}`).join(", ");
}
const esc = (s) => s.replace(/\|/g, "\\|");

const L = [];
L.push(`# DamoDemo prompt dictionary`, ``);
L.push(`**Interpreter version ${I.INTERPRETER_VERSION}.** This file is generated from \`docs/interpret.js\` by \`node tools/build_dictionary.mjs > PROMPT_DICTIONARY.md\`. Don't edit it by hand: change the vocabulary in \`interpret.js\`, bump \`INTERPRETER_VERSION\`, add a \`HISTORY\` line, and regenerate.`, ``);
L.push(`This is the free, offline interpreter in the browser version. It matches words and phrases. It doesn't use AI.`, ``);
L.push(`## Version history`, ``, `| Version | Date | What changed |`, `|---|---|---|`);
for (const h of I.HISTORY) L.push(`| ${h.version} | ${h.date} | ${esc(h.summary)} |`);
L.push(``);
L.push(`## How a request is read`, ``);
L.push(`1. **Split** into requests at \`;\`, new lines and full stops, then into parts at \`,\` \`and\` \`but\` \`then\` \`plus\` \`also\`.`);
L.push(`2. **Target:** a part that names a layer (its name, or its type such as *guitar*, *bass*, *vocal*; vocals also answer to *voice, vox, singer, singing*) applies to that layer. Following parts keep that target until another layer is named. Lists work: *“guitar and vocal brighter”*. If the layer is named at the end (*“warmer and brighter on the vocal”*), earlier parts use it too. *everything, the whole mix, overall, all the layers* targets every layer. With no layer named, a request applies to every layer.`);
L.push(`3. **Match** each phrase below. Each part of the text is used once, and earlier tables take priority.`);
L.push(`4. **Modifiers** are read from the few words before a phrase:`);
L.push(`   - *Qualities* (things you want more of) are **reversed** by: ${phrases(I.INVERT_Q, 99).join(", ").replace(/ \/ /g, ", ")}. *“less warm”* and *“too bright”* go the other way.`);
L.push(`   - *Problems* (things to fix) are fixed whether you say *“muddy”*, *“less muddy”* or *“too muddy”*. They're **reversed** only by: ${phrases(I.INVERT_P, 99).join(", ")}.`);
L.push(`   - **Half step:** ${phrases(I.SMALL, 99).join(", ").replace(/ \/ /g, ", ")}.`);
L.push(`   - **Bigger step (×1.8):** ${phrases(I.BIG, 99).join(", ").replace(/ \/ /g, ", ")}.`);
L.push(`   - Describing the level as it is (*“the vocal is quiet”*) asks for the opposite (louder). *“make it quieter”* makes it quieter.`);
L.push(`5. **Layer + up/down:** *“vocal up”*, *“guitar down 3 dB”* changes the level (2 dB if no number is given).`);
L.push(`6. Vocals ignore timing requests, since vocals get no timing correction.`);
L.push(`7. Each request is one step. Repeat it to go further. Every value stays within its setting's range (see the end of this file).`, ``);

const section = (title, kind, blurb) => {
  L.push(`## ${title}`, ``, blurb, ``, `| | Phrases | Effect (one step) |`, `|---|---|---|`);
  for (const v of I.VOCAB.filter((v) => v.kind === kind)) L.push(`| **${v.name}** | ${esc(v.show || phrases(v.re).join(" · "))} | ${esc(effect(v.ch))} |`);
  L.push(``);
};
section("Qualities: things you want more of", "q", "“less”, “not so” and “too” reverse these.");
section("Problems: things to fix", "p", "Mentioning these fixes them. “more” or “add” reverses them.");
section("Character words: move several settings at once", "m", "These behave like qualities, so *“less vintage”* reverses them.");

L.push(`## Set or remove`, ``, `| Phrases | Result |`, `|---|---|`);
for (const a of I.ABSOLUTE) L.push(`| ${esc(a.show || phrases(a.re, 3).join(" · "))} | ${a.say} |`);
L.push(`| reset · start over · back to default | the layer goes back to the preset's values |`, ``);

L.push(`## Requests it recognises but can't do`, ``, `These show a message instead of silently doing nothing.`, ``, `| Phrases | Message |`, `|---|---|`);
for (const u of I.UNSUPPORTED) L.push(`| ${esc(u.show || phrases(u.re, 3).join(" · ").slice(0, 300))} | ${esc(u.say)} |`);
L.push(``);

L.push(`## Audio Adjustments ranges`, ``, `These are the sliders under **Audio Adjustments** on each layer card.`, ``, `| Setting | Range | What it is |`, `|---|---|---|`);
for (const [p, [lo, hi, d]] of Object.entries(PARAMS)) L.push(`| ${I.LABEL[p]} (\`${p}\`) | ${lo} to ${hi} | ${d} |`);
L.push(``, `## Example requests`, ``);
for (const e of ["vocal: warmer and less harsh", "guitar is too bright", "the vocal sounds a bit nasal and muddy", "guitar and vocal: slightly wider", "I can't hear the vocal", "make the whole mix more vintage", "bass down 3 dB", "vocal: no reverb; guitar: tighter", "warmer and brighter on the vocal"])
  L.push(`- *“${e}”*`);
console.log(L.join("\n"));
