// Note and chord detection (Spotify Basic Pitch, Apache-2.0), chord naming and MIDI export.
// Runs on the device. It reads what was played; it never generates audio.

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (m) => `${NOTE[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

let modelPromise = null;
/** Load the model on first use (about 0.5 MB compressed + 0.7 MB weights). */
export function loadModel(baseUrl, modelBase = baseUrl, bundleUrl = new URL("./vendor/basic-pitch/basic-pitch.bundle.js", baseUrl).href) {
  modelPromise ??= (async () => {
    const lib = await import(bundleUrl);
    try { await lib.tf.setBackend("webgl"); } catch { /* fall back below */ }
    if (lib.tf.getBackend() !== "webgl") await lib.tf.setBackend("cpu");
    await lib.tf.ready();
    const bp = new lib.BasicPitch(new URL("./vendor/basic-pitch/model.json", modelBase).href);
    return { lib, bp };
  })();
  return modelPromise;
}

/** 44.1 kHz -> 22.05 kHz with an anti-alias low-pass (windowed-sinc FIR), as the model expects. */
export function to22k(x) {
  const taps = 63, h = new Float32Array(taps), mid = (taps - 1) / 2, fc = 0.45 / 2;   // cutoff ~9.9 kHz
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - mid, sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    h[i] = sinc * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1)));
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const out = new Float32Array(Math.floor(x.length / 2));
  for (let j = 0; j < out.length; j++) {
    const c = 2 * j; let acc = 0;
    for (let k = 0; k < taps; k++) { const idx = c + k - mid; if (idx >= 0 && idx < x.length) acc += x[idx] * h[k]; }
    out[j] = acc;
  }
  return out;
}

/** Keep one note at a time (for vocals / bass / lead): the strongest overlapping note wins. */
function monophonic(notes, preferLow = false) {
  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const out = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n.startTimeSeconds < last.startTimeSeconds + last.durationSeconds - 0.03) {
      const better = preferLow ? n.pitchMidi < last.pitchMidi : n.amplitude > last.amplitude;
      if (better) { last.durationSeconds = Math.max(0.02, n.startTimeSeconds - last.startTimeSeconds); out.push({ ...n }); }
      continue;
    }
    out.push({ ...n });
  }
  // join repeats of the same note with tiny gaps (vibrato or slight wobble splits long notes)
  const joined = [];
  for (const n of out.filter((x) => x.durationSeconds >= 0.06)) {
    const last = joined[joined.length - 1];
    if (last && last.pitchMidi === n.pitchMidi && n.startTimeSeconds - (last.startTimeSeconds + last.durationSeconds) < 0.12) {
      last.durationSeconds = n.startTimeSeconds + n.durationSeconds - last.startTimeSeconds;
      last.amplitude = Math.max(last.amplitude, n.amplitude);
    } else joined.push({ ...n });
  }
  return joined;
}

/**
 * Detect notes in a mono 44.1 kHz layer.
 * type: sound type (vocal / bass / guitars); onProgress(0..1)
 * Returns [{start, dur, midi, vel}] in seconds.
 */
export async function detectNotes(audio44k, type, baseUrl, onProgress = () => {}, modelBase = baseUrl, bundleUrl) {
  const { lib, bp } = await loadModel(baseUrl, modelBase, bundleUrl);
  const x = to22k(audio44k);
  const frames = [], onsets = [], contours = [];
  await bp.evaluateModel(x, (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); }, onProgress);
  const poly = type !== "vocal" && type !== "bass";
  const events = lib.outputToNotesPoly(frames, onsets, poly ? 0.5 : 0.45, poly ? 0.3 : 0.28, poly ? 5 : 6);
  let notes = lib.noteFramesToTime(lib.addPitchBendsToNoteEvents(contours, events));
  if (type === "vocal") notes = monophonic(notes.filter((n) => n.pitchMidi >= 40 && n.pitchMidi <= 88));
  else if (type === "bass") notes = monophonic(notes.filter((n) => n.pitchMidi <= 60), true);
  return notes
    .map((n) => ({ start: n.startTimeSeconds, dur: n.durationSeconds, midi: n.pitchMidi, vel: Math.max(20, Math.min(127, Math.round(40 + n.amplitude * 90))) }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
}

// ---------------------------------------------------------------- chords
const SHAPES = [
  ["", [0, 4, 7], 1.0], ["m", [0, 3, 7], 1.0], ["7", [0, 4, 7, 10], 0.86], ["maj7", [0, 4, 7, 11], 0.84],
  ["m7", [0, 3, 7, 10], 0.86], ["sus4", [0, 5, 7], 0.82], ["sus2", [0, 2, 7], 0.82], ["dim", [0, 3, 6], 0.78],
];
/**
 * Name the chord in each segment. bounds: segment start times in seconds (ascending), plus end.
 * Uses note durations x loudness per pitch class, with extra weight on the lowest note.
 */
export function chordsFromNotes(notes, bounds) {
  const out = [];
  for (let s = 0; s + 1 < bounds.length; s++) {
    const a = bounds[s], b = bounds[s + 1], pc = new Float64Array(12), struck = new Float64Array(12);
    let lowest = null, total = 0;
    for (const n of notes) {
      const ov = Math.min(b, n.start + n.dur) - Math.max(a, n.start);
      if (ov <= 0) continue;
      // notes struck in this segment count fully; notes still ringing from before count less
      const fresh = n.start >= a - 0.05;
      const w = ov * n.vel * (fresh ? 1 : 0.3);
      pc[n.midi % 12] += w; total += w;
      if (fresh) struck[n.midi % 12] += w;
      if (!lowest || n.midi < lowest.midi) lowest = n;
    }
    if (total < 1e-6) { out.push({ start: a, end: b, chord: null }); continue; }
    if (lowest) pc[lowest.midi % 12] += total * 0.15;
    let best = { score: -Infinity, name: null };
    const struckTotal = struck.reduce((t, v) => t + v, 0) || 1;
    for (let root = 0; root < 12; root++) for (const [q, ints, bias] of SHAPES) {
      // a 7th / sus / extension only counts if that note is actually played in this segment
      if (ints.length > 3 && struck[(root + ints[3]) % 12] < 0.12 * struckTotal) continue;
      let inside = 0;
      for (const i of ints) inside += pc[(root + i) % 12];
      const outside = pc.reduce((t, v) => t + v, 0) - inside;
      const rootBonus = pc[root] * 0.3 + (lowest && lowest.midi % 12 === root ? total * 0.1 : 0);
      const score = (inside - 0.6 * outside + rootBonus) * bias - ints.length * total * 0.01;
      if (score > best.score) best = { score, name: NOTE[root] + q };
    }
    out.push({ start: a, end: b, chord: best.name });
  }
  // merge repeats
  const merged = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last && last.chord === c.chord) last.end = c.end; else merged.push({ ...c });
  }
  return merged;
}

/** Chord per bar for a chord chart: [{bar, chords:[names]}] using half-bar resolution. grid = half-beat sample positions. */
export function chordChart(notes, grid, sr = 44100) {
  if (!grid || grid.length < 9) return [];
  const halfBar = [];
  for (let i = 0; i < grid.length; i += 4) halfBar.push(grid[i] / sr);
  const last = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const bounds = halfBar.filter((t) => t <= last + 0.5);
  if (bounds.length < 2) return [];
  const segs = chordsFromNotes(notes, bounds.concat([bounds[bounds.length - 1] + (bounds[1] - bounds[0])]));
  // expand merged segments back to half-bars, then group into bars
  const perHalf = bounds.map((t) => (segs.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6) || {}).chord || null);
  const bars = [];
  for (let i = 0; i < perHalf.length; i += 2) {
    const a = perHalf[i], b = perHalf[i + 1];
    bars.push({ bar: i / 2 + 1, chords: b && b !== a ? [a || "N.C.", b] : [a || "N.C."] });
  }
  return bars;
}

// ---------------------------------------------------------------- MIDI (Standard MIDI File, type 1)
const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
const GM = { vocal: 53, acoustic_guitar: 25, electric_guitar: 27, bass: 33 };   // voice oohs, steel/clean guitar, finger bass

/** tracks: [{name, type, notes}] ; tempo in BPM. Note times stay absolute, so MIDI lines up with the audio from 0:00. */
export function toMidi(tracks, tempo = 120) {
  const ppq = 480, ticks = (sec) => Math.round((sec * tempo / 60) * ppq);
  const chunk = (id, data) => [...[...id].map((c) => c.charCodeAt(0)), (data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255, ...data];
  const text = (s) => [...new TextEncoder().encode(s)];
  const usPerQ = Math.round(60000000 / tempo);
  const conductor = [0, 0xff, 0x51, 3, (usPerQ >> 16) & 255, (usPerQ >> 8) & 255, usPerQ & 255,
    0, 0xff, 0x58, 4, 4, 2, 24, 8, 0, 0xff, 0x03, ...vlq(8), ...text("DamoDemo"), 0, 0xff, 0x2f, 0];
  const out = [...chunk("MThd", [0, 1, 0, tracks.length + 1, (ppq >> 8) & 255, ppq & 255]), ...chunk("MTrk", conductor)];
  tracks.forEach((t, i) => {
    const ch = i % 16 === 9 ? 10 : i % 16, name = text(t.name);
    const ev = [];
    for (const n of t.notes) {
      ev.push({ t: ticks(n.start), on: true, m: n.midi, v: n.vel });
      ev.push({ t: Math.max(ticks(n.start) + 1, ticks(n.start + n.dur)), on: false, m: n.midi, v: 0 });
    }
    ev.sort((a, b) => a.t - b.t || (a.on === b.on ? 0 : a.on ? 1 : -1));
    const data = [0, 0xff, 0x03, ...vlq(name.length), ...name, 0, 0xc0 | ch, GM[t.type] ?? 0];
    let prev = 0;
    for (const e of ev) { data.push(...vlq(e.t - prev), (e.on ? 0x90 : 0x80) | ch, e.m & 127, e.v & 127); prev = e.t; }
    data.push(0, 0xff, 0x2f, 0);
    out.push(...chunk("MTrk", data));
  });
  return new Uint8Array(out);
}
