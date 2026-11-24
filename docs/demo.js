// Two deliberately sloppy test takes (strummed guitar + synthetic "vocal")
// with loose timing, off-pitch notes and hiss. Crude synth stand-ins: they
// show what the processing does, not how real instruments will sound.
import { SR } from "./engine.js";

const BPM = 90, BEAT = 60 / BPM, BARS = 8, LEN = Math.round((BARS * 4 * BEAT + 2) * SR);

function rng(seed) {
  let s = seed;
  const u = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return { u, n: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()) };
}
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function pluck(freq, dur, r) {
  const n = Math.round(dur * SR), period = Math.max(2, Math.round(SR / freq));
  const buf = Float32Array.from({ length: period }, () => r.u() * 2 - 1), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i % period;
    out[i] = buf[a];
    buf[a] = 0.996 * 0.5 * (buf[a] + buf[(a + 1) % period]);
  }
  return out;
}

export function demoGuitar() {
  const r = rng(7), y = new Float32Array(LEN), cache = {};
  const CH = { C: [48, 52, 55, 60, 64], G: [43, 47, 50, 55, 59, 67], Am: [45, 52, 57, 60, 64], F: [41, 48, 53, 57, 60] };
  const prog = ["C", "G", "Am", "F", "C", "G", "Am", "F"];
  prog.forEach((ch, bar) => {
    for (let beat = 0; beat < 4; beat++) {
      const t = (bar * 4 + beat) * BEAT + 0.5 + r.n() * 0.035;     // sloppy timing
      const down = beat % 2 === 0, notes = down ? CH[ch] : [...CH[ch]].reverse();
      notes.forEach((m, j) => {
        cache[m] ??= pluck(mtof(m), 1.6, r);
        const s = Math.round((t + j * 0.012) * SR), seg = cache[m], g = down ? 0.9 : 0.6;
        for (let i = 0; i < seg.length && s + i < LEN; i++) y[s + i] += seg[i] * g;
      });
    }
  });
  return finish(y, r, 0.004);
}

export function demoVocal() {
  const r = rng(11), y = new Float32Array(LEN);
  const melody = [64, 67, 69, 67, 64, 62, 60, 62, 64, 67, 72, 71, 69, 67, 64, 60];
  melody.forEach((m, k) => {
    const start = 0.5 + k * 2 * BEAT + r.n() * 0.04, dur = 2 * BEAT * 0.85;
    const cents = (r.u() < 0.5 ? -1 : 1) * (15 + r.u() * 30);          // off pitch
    const f = mtof(m + cents / 100), n = Math.round(dur * SR), s0 = Math.round(start * SR);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.3);
      ph += (2 * Math.PI * f * vib) / SR;
      let tone = 0; for (let h = 1; h <= 8; h++) tone += (0.8 / h) * Math.sin(h * ph);
      const env = Math.min(1, t / 0.06) * Math.min(1, Math.max(0, (dur - t) / 0.12));
      if (s0 + i < LEN) y[s0 + i] += tone * env;
    }
  });
  return finish(y, r, 0.006);
}

function finish(y, r, hiss) {
  let pk = 0;
  for (let i = 0; i < y.length; i++) { y[i] += r.n() * hiss; pk = Math.max(pk, Math.abs(y[i])); }
  for (let i = 0; i < y.length; i++) y[i] = (y[i] / pk) * 0.6;
  return y;
}
