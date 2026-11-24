import * as E from "../docs/engine.js";
import { demoGuitar, demoVocal } from "../docs/demo.js";
import { defaultSettings, applyPrompt } from "../docs/settings.js";
import { writeFileSync, mkdirSync } from "fs";

const out = process.argv[2] || "/tmp/lp_test";
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const layers = [{ name: "guitar", type: "acoustic_guitar", raw: demoGuitar() }, { name: "vocal", type: "vocal", raw: demoVocal() }];
const L = Object.fromEntries(layers.map(l => [l.name, l]));
const settings = Object.fromEntries(layers.map(l => [l.name, defaultSettings(l.type, "intimate_acoustic")]));
console.log("prompt changes", JSON.stringify(applyPrompt("vocal: warmer and less harsh; guitar: tighter", L, settings)));
const res = await E.runSession(layers, settings, async m => console.log(" ", m));
console.log("seconds", (Date.now() - t0) / 1000);
console.log(JSON.stringify(res.log.song), res.log.song_pass);
for (const [n, l] of Object.entries(res.log.layers)) {
  console.log(n, l.steps.join(" | "));
  if (l.before.timing) console.log("  timing ms", l.before.timing.mean_ms, "->", l.after.timing.mean_ms, " chords", l.before.chords.slice(0,8).map(c=>c.chord).join(" "));
  console.log("  quietest dB", l.before.describe.quietest_db, "->", l.after.describe.quietest_db, " lufs", l.before.describe.lufs, "->", l.after.describe.lufs);
}
writeFileSync(`${out}/guitar_raw.wav`, Buffer.from(E.encodeWav([layers[0].raw])));
writeFileSync(`${out}/vocal_raw.wav`, Buffer.from(E.encodeWav([layers[1].raw])));
writeFileSync(`${out}/mix.wav`, Buffer.from(E.encodeWav(res.mix)));
writeFileSync(`${out}/raw_mix.wav`, Buffer.from(E.encodeWav([res.rawMix])));
res.polished.forEach(p => writeFileSync(`${out}/${p.name}_polished.wav`, Buffer.from(E.encodeWav([p.audio]))));
console.log("mix LUFS(js)", E.lufs(res.mix).toFixed(2), "peak", E.peakDb(res.mix[0]).toFixed(2), E.peakDb(res.mix[1]).toFixed(2));
