// Background jobs so the page stays responsive.
// Messages in:  {id, cmd: "analyse" | "polish" | "mix", ...}
// Messages out: {id, result} or {id, error}
import * as E from "./engine.js";

const jobs = {
  // tempo grid from the timing master, key from all layers together
  analyse({ master, all }) {
    const { tempo, grid } = E.detectTempoGrid(master);
    const n = Math.max(...all.map((a) => a.length)), sum = new Float32Array(n);
    for (const a of all) for (let i = 0; i < a.length; i++) sum[i] += a[i];
    return { result: { tempo, grid: Int32Array.from(grid), key: E.detectKey(sum) } };
  },

  // polish one layer and report before/after
  polish({ raw, type, settings, grid }) {
    grid = Array.from(grid);
    const before = { describe: E.describe(raw) };
    if (type !== "vocal") {
      before.timing = E.timingReport(E.detectOnsets(raw).onsets, grid);
      before.chords = E.recogniseChords(raw, grid);
    }
    const { audio, steps } = E.polishLayer(raw, type, settings, grid);
    const after = { describe: E.describe(audio) };
    if (type !== "vocal") after.timing = E.timingReport(E.detectOnsets(audio).onsets, grid);
    return { result: { audio, steps, before, after }, transfer: [audio.buffer] };
  },

  // song-level pass on exactly the layers given (raw or polished, as chosen in the mixer)
  mix({ layers, raws }) {
    const { stereo, actions, finalLufs } = E.songPass(layers);
    // the same layers unprocessed, loudness-matched, for a fair before/after
    const n = stereo[0].length, sum = new Float32Array(n);
    for (const r of raws) for (let i = 0; i < Math.min(n, r.length); i++) sum[i] += r[i];
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(sum[i]));
    let g = 10 ** ((E.lufs(stereo) - E.lufs([sum, sum])) / 20);
    if (pk * g > 0.99) g = 0.99 / pk;
    for (let i = 0; i < n; i++) sum[i] *= g;
    return { result: { stereo, actions, finalLufs, rawMix: sum }, transfer: [stereo[0].buffer, stereo[1].buffer, sum.buffer] };
  },
};

self.onmessage = (e) => {
  const { id, cmd, ...args } = e.data;
  try {
    const { result, transfer = [] } = jobs[cmd](args);
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
