// Runs Basic Pitch on the demo takes and checks chords, melody and the MIDI file.
// Needs the docs folder served on :8765 (for the model weights): python3 -m http.server 8765 -d docs
import { detectNotes, chordChart, toMidi, noteName } from "../docs/notes.js";
import { demoGuitar, demoVocal } from "../docs/demo.js";
import { detectTempoGrid } from "../docs/engine.js";
import { writeFileSync } from "fs";
import { pathToFileURL } from "url";
const base = pathToFileURL(new URL("../docs/", import.meta.url).pathname).href, model = "http://localhost:8765/";
const bundle = process.env.BP_BUNDLE || undefined;   // Node needs a Node build of the bundle (see README)
const g = demoGuitar(), v = demoVocal();
const { tempo, grid } = detectTempoGrid(g);
let t0 = Date.now();
const gn = await detectNotes(g, "acoustic_guitar", base, () => {}, model, bundle);
console.log(`guitar: ${gn.length} notes in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const chart = chordChart(gn, Array.from(grid));
console.log("chord chart:", chart.map((b) => b.chords.join(" ")).join(" | "));
t0 = Date.now();
const vn = await detectNotes(v, "vocal", base, () => {}, model, bundle);
console.log(`vocal: ${vn.length} notes in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log("melody:", vn.map((n) => noteName(n.midi)).join(" "));
const midi = toMidi([{ name: "guitar", type: "acoustic_guitar", notes: gn }, { name: "vocal", type: "vocal", notes: vn }], tempo);
writeFileSync("/tmp/demo.mid", midi);
console.log("midi bytes:", midi.length, "tempo", tempo.toFixed(1));
