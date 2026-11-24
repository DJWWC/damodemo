import { encodeWav, encodeAiff, zip } from "../docs/export.js";
import { writeFileSync, mkdirSync } from "fs";
const out = process.argv[2] || "/tmp/exp"; mkdirSync(out, { recursive: true });
const sr = 44100, n = sr * 2;
const L = new Float32Array(n).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / sr));
const R = new Float32Array(n).map((_, i) => 0.25 * Math.sin(2 * Math.PI * 660 * i / sr));
const files = {
  "s16.wav": encodeWav([L, R], sr, 16), "s24.wav": encodeWav([L, R], sr, 24), "s32f.wav": encodeWav([L, R], sr, "32f"),
  "m24.wav": encodeWav([L], sr, 24), "s24.aif": encodeAiff([L, R], sr, 24), "m24.aif": encodeAiff([L], sr, 24),
};
for (const [k, v] of Object.entries(files)) writeFileSync(`${out}/${k}`, v);
writeFileSync(`${out}/bundle.zip`, zip([{ name: "a.wav", data: files["s24.wav"] }, { name: "notes.txt", data: "hello" }]));
console.log("written");
