// LayerPolish browser engine. Pure JavaScript DSP: no uploads, no Web Audio
// dependency, so it behaves the same in every browser and in Node tests.
// Every function edits or processes the user's own audio; nothing is generated.

import { SOUND_TYPES } from "./settings.js";

export const SR = 44100;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ---------------------------------------------------------------- FFT
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Magnitude spectrogram: returns {mags: Float32Array[], nfft, hop} */
function spectrogram(y, nfft = 2048, hop = 512) {
  const w = hann(nfft), nb = nfft / 2 + 1, mags = [];
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let s = 0; s + nfft <= y.length; s += hop) {
    for (let i = 0; i < nfft; i++) { re[i] = y[s + i] * w[i]; im[i] = 0; }
    fft(re, im);
    const m = new Float32Array(nb);
    for (let b = 0; b < nb; b++) m[b] = Math.hypot(re[b], im[b]);
    mags.push(m);
  }
  return { mags, nfft, hop };
}

// ---------------------------------------------------------------- helpers
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
const undb = (d) => 10 ** (d / 20);

function frameRms(y, frame = 2048) {
  const n = Math.floor(y.length / frame), out = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) s += y[i] * y[i];
    out[f] = Math.sqrt(s / frame + 1e-12);
  }
  return out;
}

function percentile(arr, p) {
  const a = Array.from(arr).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))))];
}

export function peakDb(y) {
  let m = 0;
  for (let i = 0; i < y.length; i++) m = Math.max(m, Math.abs(y[i]));
  return db(m);
}

// ---------------------------------------------------------------- biquads (RBJ cookbook)
function biquadCoefs(type, fc, sr, { gainDb = 0, q = 0.7071 } = {}) {
  const A = 10 ** (gainDb / 40), w0 = (2 * Math.PI * fc) / sr, cs = Math.cos(w0), al = Math.sin(w0) / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  const sA = 2 * Math.sqrt(A) * al;
  switch (type) {
    case "highpass":
      b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
    case "peaking":
      b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; break;
    case "lowshelf":
      b0 = A * ((A + 1) - (A - 1) * cs + sA); b1 = 2 * A * ((A - 1) - (A + 1) * cs);
      b2 = A * ((A + 1) - (A - 1) * cs - sA); a0 = (A + 1) + (A - 1) * cs + sA;
      a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - sA; break;
    case "highshelf":
      b0 = A * ((A + 1) + (A - 1) * cs + sA); b1 = -2 * A * ((A - 1) + (A + 1) * cs);
      b2 = A * ((A + 1) + (A - 1) * cs - sA); a0 = (A + 1) - (A - 1) * cs + sA;
      a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - sA; break;
    default: throw new Error(type);
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function biquad(y, c) {
  const [b0, b1, b2, a1, a2] = c, out = new Float32Array(y.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < y.length; i++) {
    const x = y[i], o = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = o; out[i] = o;
  }
  return out;
}

// ---------------------------------------------------------------- loudness (ITU-R BS.1770)
export function lufs(channels, sr = SR) {
  const hs = biquadCoefs("highshelf", 1500, sr, { gainDb: 4, q: 1 / Math.SQRT2 });
  const hp = biquadCoefs("highpass", 38, sr, { q: 0.5 });
  const k = channels.map((c) => biquad(biquad(c, hs), hp));
  const block = Math.round(0.4 * sr), step = Math.round(0.1 * sr), z = [];
  for (let s = 0; s + block <= k[0].length; s += step) {
    let sum = 0;
    for (const c of k) { let e = 0; for (let i = s; i < s + block; i++) e += c[i] * c[i]; sum += e / block; }
    z.push(sum);
  }
  const L = (v) => -0.691 + 10 * Math.log10(Math.max(v, 1e-12));
  const abs = z.filter((v) => L(v) > -70);
  if (!abs.length) return -70;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const g = abs.filter((v) => L(v) > rel);
  return L(g.reduce((a, b) => a + b, 0) / g.length);
}

// ---------------------------------------------------------------- recognition
/** Onset strength envelope (spectral flux) + backtracked onset positions in samples. */
export function detectOnsets(y) {
  const { mags, hop } = spectrogram(y, 2048, 512);
  const env = new Float64Array(mags.length);
  for (let f = 1; f < mags.length; f++) {
    let s = 0;
    for (let b = 0; b < mags[f].length; b++) {
      const d = Math.log1p(100 * mags[f][b]) - Math.log1p(100 * mags[f - 1][b]);
      if (d > 0) s += d;
    }
    env[f] = s;
  }
  const max = Math.max(...env) || 1;
  for (let f = 0; f < env.length; f++) env[f] /= max;
  const energy = mags.map((m) => m.reduce((a, b) => a + b, 0));
  const onsets = [], minGap = Math.round((0.1 * SR) / hop);
  let last = -Infinity;
  for (let f = 3; f < env.length - 3; f++) {
    let isMax = true;
    for (let k = -3; k <= 3; k++) if (env[f + k] > env[f]) isMax = false;
    if (!isMax) continue;
    let m = 0, c = 0;
    for (let k = Math.max(0, f - 16); k < Math.min(env.length, f + 16); k++) { m += env[k]; c++; }
    if (env[f] < m / c + 0.07 || f - last < minGap) continue;
    onsets.push(refineOnset(y, f * hop - hop, f * hop + 2048 + hop));
    last = f;
  }
  return { env, hop, onsets };
}

/** Find the actual attack inside a frame region: the sharpest rise in short-term energy. */
function refineOnset(y, a, b) {
  a = Math.max(0, a); b = Math.min(y.length, b);
  const blk = 128, step = 64;
  let best = a, bestRise = -Infinity, prev = null;
  for (let s = a; s + blk <= b; s += step) {
    let e = 1e-10;
    for (let i = s; i < s + blk; i++) e += y[i] * y[i];
    const l = 10 * Math.log10(e);
    if (prev !== null && l - prev > bestRise) { bestRise = l - prev; best = s; }
    prev = l;
  }
  return best;
}

/** Tempo + a steady grid (beats split in `sub`) in sample positions. */
export function detectTempoGrid(y, sub = 2) {
  const { env, hop, onsets } = detectOnsets(y);
  const fps = SR / hop;
  let best = { score: -Infinity, lag: 0 };
  for (let lag = Math.floor((fps * 60) / 180); lag <= Math.ceil((fps * 60) / 60); lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    const bpm = (60 * fps) / lag;
    s *= Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);   // prefer ~110 BPM
    if (s > best.score) best = { score: s, lag };
  }
  // refine the beat period (fractional frames) and phase against the onsets
  let period = best.lag * hop, phase = 0, bestFit = Infinity;
  for (let p = period * 0.97; p <= period * 1.03; p += period * 0.0025) {
    for (let ph = 0; ph < p; ph += hop / 2) {
      let err = 0;
      for (const o of onsets) { const r = (((o - ph) % (p / sub)) + p / sub) % (p / sub); err += Math.min(r, p / sub - r); }
      if (err < bestFit) { bestFit = err; period = p; phase = ph; }
    }
  }
  const grid = [];
  for (let t = phase; t < y.length; t += period / sub) grid.push(Math.round(t));
  return { tempo: (60 * SR) / period, grid, onsets };
}

export function timingReport(onsets, grid) {
  if (!onsets.length || !grid.length) return { events: 0, mean_ms: 0, max_ms: 0 };
  const d = onsets.map((o) => {
    let m = Infinity;
    for (const g of grid) m = Math.min(m, Math.abs(g - o));
    return (m / SR) * 1000;
  });
  return { events: d.length, mean_ms: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1), max_ms: +Math.max(...d).toFixed(1) };
}

function chromaFrames(y) {
  const { mags, nfft } = spectrogram(y, 4096, 2048);
  return mags.map((m) => {
    const c = new Float64Array(12);
    for (let b = 1; b < m.length; b++) {
      const f = (b * SR) / nfft;
      if (f < 60 || f > 2000) continue;
      const pc = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12;
      c[pc] += m[b] * m[b];
    }
    return c;
  });
}

export function detectKey(y) {
  const maj = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const min = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const frames = chromaFrames(y), c = new Float64Array(12);
  for (const f of frames) { const s = f.reduce((a, b) => a + b, 0) || 1; for (let i = 0; i < 12; i++) c[i] += f[i] / s; }
  const corr = (a, b) => {
    const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12;
    let n = 0, da = 0, dbb = 0;
    for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2; }
    return n / Math.sqrt(da * dbb);
  };
  let best = { r: -Infinity };
  for (let t = 0; t < 12; t++) for (const [mode, prof] of [["major", maj], ["minor", min]]) {
    const rot = prof.map((_, i) => prof[(i - t + 12) % 12]);
    const r = corr(Array.from(c), rot);
    if (r > best.r) best = { r, name: `${NOTE_NAMES[t]} ${mode}` };
  }
  return best.name;
}

export function recogniseChords(y, grid) {
  const frames = chromaFrames(y), hop = 2048, out = [];
  const templates = [];
  for (let r = 0; r < 12; r++) for (const [q, ints] of [["", [0, 4, 7]], ["m", [0, 3, 7]]]) {
    const t = new Float64Array(12); ints.forEach((i) => (t[(r + i) % 12] = 1)); templates.push([NOTE_NAMES[r] + q, t]);
  }
  let last = null;
  for (let g = 0; g + 1 < grid.length; g += 2) {
    const a = Math.floor(grid[g] / hop), b = Math.max(a + 1, Math.floor(grid[g + 2 < grid.length ? g + 2 : g + 1] / hop));
    const seg = new Float64Array(12);
    for (let f = a; f < Math.min(b, frames.length); f++) for (let i = 0; i < 12; i++) seg[i] += frames[f][i];
    const norm = Math.hypot(...seg);
    if (norm < 1e-6) continue;
    let bestName = null, bestScore = -1;
    for (const [name, t] of templates) {
      let s = 0; for (let i = 0; i < 12; i++) s += t[i] * seg[i];
      if (s > bestScore) { bestScore = s; bestName = name; }
    }
    if (bestName !== last) { out.push({ time_s: +(grid[g] / SR).toFixed(2), chord: bestName }); last = bestName; }
  }
  return out;
}

function bandShares(y) {
  const { mags, nfft } = spectrogram(y, 4096, 2048);
  const bands = { low: [80, 250], low_mid: [250, 600], mid: [600, 2000], presence: [2000, 5000], air: [5000, 16000] };
  const sums = Object.fromEntries(Object.keys(bands).map((k) => [k, 0]));
  let total = 1e-12;
  for (const m of mags) for (let b = 0; b < m.length; b++) {
    const f = (b * SR) / nfft, e = m[b] * m[b];
    total += e;
    for (const [k, [lo, hi]] of Object.entries(bands)) if (f >= lo && f < hi) sums[k] += e;
  }
  return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, +(10 * Math.log10(v / total + 1e-12)).toFixed(1)]));
}

export function hissLevelDb(y) {
  return +db(percentile(frameRms(y), 5)).toFixed(1);
}

export function describe(y) {
  return { lufs: +lufs([y]).toFixed(1), peak_db: +peakDb(y).toFixed(1), quietest_db: hissLevelDb(y), bands_db: bandShares(y) };
}

// ---------------------------------------------------------------- repair
/** Spectral-gate noise reduction. Learns the noise from the quietest 0.3 s. */
export function denoise(y, strength) {
  if (strength <= 0) return { out: y, note: "noise reduction off" };
  const nfft = 2048, hop = 512, nb = nfft / 2 + 1, w = hann(nfft);
  const win = Math.round(0.3 * SR);
  let quiet = 0, qE = Infinity;
  for (let s = 0; s + win < y.length; s += win >> 1) {
    let e = 0; for (let i = s; i < s + win; i++) e += y[i] * y[i];
    if (e < qE) { qE = e; quiet = s; }
  }
  const noise = spectrogram(y.subarray(quiet, quiet + win), nfft, hop).mags;
  const mean = new Float64Array(nb), sd = new Float64Array(nb);
  for (const m of noise) for (let b = 0; b < nb; b++) mean[b] += m[b] / noise.length;
  for (const m of noise) for (let b = 0; b < nb; b++) sd[b] += (m[b] - mean[b]) ** 2 / noise.length;
  const thresh = mean.map((m, b) => m + 1.5 * Math.sqrt(sd[b]));
  const floor = 1 - (0.5 + 0.5 * strength);
  const pad = nfft;
  const x = new Float32Array(y.length + 2 * pad); x.set(y, pad);
  const out = new Float64Array(x.length), norm = new Float64Array(x.length);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  let prev = new Float64Array(nb);
  for (let s = 0; s + nfft <= x.length; s += hop) {
    for (let i = 0; i < nfft; i++) { re[i] = x[s + i] * w[i]; im[i] = 0; }
    fft(re, im);
    const mask = new Float64Array(nb);
    for (let b = 0; b < nb; b++) mask[b] = Math.hypot(re[b], im[b]) > thresh[b] ? 1 : 0;
    const g = new Float64Array(nb);
    for (let b = 0; b < nb; b++) {   // smooth across frequency and time to avoid "musical noise"
      const m = (mask[Math.max(0, b - 1)] + mask[b] + mask[Math.min(nb - 1, b + 1)]) / 3;
      const sm = Math.max(m, prev[b] * 0.5);
      g[b] = floor + (1 - floor) * sm;
    }
    prev = g;
    for (let b = 0; b < nb; b++) {
      re[b] *= g[b]; im[b] *= g[b];
      if (b > 0 && b < nb - 1) { re[nfft - b] = re[b]; im[nfft - b] = -im[b]; }
    }
    fft(re, im, true);
    for (let i = 0; i < nfft; i++) { out[s + i] += re[i] * w[i]; norm[s + i] += w[i] * w[i]; }
  }
  const res = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) res[i] = out[i + pad] / Math.max(norm[i + pad], 1e-6);
  return { out: res, note: `noise reduction ${Math.round(strength * 100)}%` };
}

/** Slide each played event towards the nearest grid line (original audio, moved).
 *  Each slice runs from its attack to the next attack. If moving opens a gap,
 *  the slice's own decay (from just before the next attack) is spliced in to
 *  fill it, so the next attack is never duplicated. */
export function tightenTiming(y, grid, strength, maxShiftMs = 80) {
  if (strength <= 0) return { out: y, note: "timing left as played" };
  const { onsets } = detectOnsets(y);
  if (onsets.length < 2) return { out: y, note: "not enough events to tighten" };
  const maxShift = Math.round((SR * maxShiftMs) / 1000);
  const fi = Math.round(0.002 * SR), fo = Math.round(0.02 * SR);
  const starts = onsets.map((a) => {
    let t = grid[0];
    for (const g of grid) if (Math.abs(g - a) < Math.abs(t - a)) t = g;
    return a + Math.max(-maxShift, Math.min(maxShift, Math.round((t - a) * strength)));
  });
  for (let k = 1; k < starts.length; k++) starts[k] = Math.max(starts[k], starts[k - 1] + fi + fo);  // keep order
  const out = new Float32Array(y.length);
  // lead-in before the first event, faded out where the first slice lands
  const leadEnd = Math.min(onsets[0], starts[0]);
  for (let i = 0; i < leadEnd; i++) out[i] = y[i];
  let moved = 0;
  for (let k = 0; k < onsets.length; k++) {
    const a = onsets[k], b = k + 1 < onsets.length ? onsets[k + 1] : y.length;
    const st = starts[k], nextSt = k + 1 < onsets.length ? starts[k + 1] : st + (b - a);
    const last = k + 1 === onsets.length;
    const want = Math.max(1, nextSt - st + (last ? 0 : fo));
    let seg = y.slice(a, b);
    if (want > seg.length) {                       // stretch the decay to fill the gap
      const ext = want - seg.length, src0 = Math.max(a, b - ext - fo);
      const filler = y.slice(src0, b), joined = new Float32Array(want);
      joined.set(seg);
      const j0 = Math.max(0, seg.length - fo);
      for (let i = 0; i < fo && j0 + i < seg.length; i++) joined[j0 + i] *= 1 - i / fo;
      for (let i = 0; i < filler.length && j0 + i < want; i++) joined[j0 + i] += filler[i] * (i < fo ? i / fo : 1);
      seg = joined;
    } else seg = seg.slice(0, want);
    for (let i = 0; i < Math.min(fi, seg.length); i++) seg[i] *= i / fi;
    if (!last) for (let i = 0; i < Math.min(fo, seg.length); i++) seg[seg.length - 1 - i] *= i / fo;
    for (let i = 0; i < seg.length && st + i < out.length; i++) if (st + i >= 0) out[st + i] += seg[i];
    moved += Math.abs(st - a);
  }
  return { out, note: `moved ${onsets.length} events towards the beat (avg ${Math.round((moved / onsets.length / SR) * 1000)} ms, strength ${Math.round(strength * 100)}%)` };
}

/** Downward expander that turns down leftover noise in the gaps (vocals). */
export function gateGaps(y, strength) {
  if (strength <= 0) return y;
  const thr = percentile(frameRms(y), 5) * undb(16), ratio = 1 + 6 * strength;
  const win = Math.round(0.01 * SR), out = new Float32Array(y.length);
  const att = Math.exp(-1 / (0.002 * SR)), rel = Math.exp(-1 / (0.15 * SR));
  let acc = 0, g = 1;
  for (let i = 0; i < y.length; i++) {
    acc += y[i] * y[i] - (i >= win ? y[i - win] * y[i - win] : 0);
    const env = Math.sqrt(Math.max(acc, 0) / win);
    const target = env >= thr ? 1 : Math.pow(env / thr, ratio - 1);
    g = target < g ? att * g + (1 - att) * target : rel * g + (1 - rel) * target;
    out[i] = y[i] * g;
  }
  return out;
}

// ---------------------------------------------------------------- tone chain
function compressor(chans, thresholdDb, ratio, attackMs = 8, releaseMs = 120, kneeDb = 6) {
  const att = Math.exp(-1 / ((attackMs / 1000) * SR)), rel = Math.exp(-1 / ((releaseMs / 1000) * SR));
  const n = chans[0].length, outs = chans.map(() => new Float32Array(n));
  let env = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (const c of chans) x = Math.max(x, Math.abs(c[i]));
    env = x > env ? att * env + (1 - att) * x : rel * env + (1 - rel) * x;
    const over = db(env) - thresholdDb;
    let gr = 0;
    if (over > kneeDb / 2) gr = over * (1 - 1 / ratio);
    else if (over > -kneeDb / 2) gr = ((1 - 1 / ratio) * (over + kneeDb / 2) ** 2) / (2 * kneeDb);
    const g = undb(-gr);
    for (let c = 0; c < chans.length; c++) outs[c][i] = chans[c][i] * g;
  }
  return outs;
}

function saturate(y, driveDb) {
  const k = undb(driveDb), trim = undb(-driveDb * 0.6), out = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = Math.tanh(k * y[i]) * trim;
  return out;
}

let irCache = {};
function impulse(size) {
  const key = size.toFixed(2);
  if (irCache[key]) return irCache[key];
  const len = Math.round((0.4 + size * 2.6) * SR), ir = new Float32Array(len);
  let seed = 12345, e = 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const pre = Math.round(0.012 * SR);
  for (let i = pre; i < len; i++) { ir[i] = rnd() * Math.exp((-6.9 * (i - pre)) / (len - pre)); }
  // gentle damping of highs
  const lp = biquadCoefs("highshelf", 4000, SR, { gainDb: -6 });
  const d = biquad(ir, lp);
  for (let i = 0; i < len; i++) e += d[i] * d[i];
  const s = 1 / Math.sqrt(e);
  for (let i = 0; i < len; i++) d[i] *= s;
  return (irCache[key] = d);
}

function convolve(y, ir) {
  const block = 8192;
  let nfft = 1; while (nfft < block + ir.length - 1) nfft <<= 1;
  const hr = new Float64Array(nfft), hi = new Float64Array(nfft);
  hr.set(ir); fft(hr, hi);
  const out = new Float32Array(y.length + ir.length);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let s = 0; s < y.length; s += block) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < block && s + i < y.length; i++) re[i] = y[s + i];
    fft(re, im);
    for (let b = 0; b < nfft; b++) {
      const r = re[b] * hr[b] - im[b] * hi[b], m = re[b] * hi[b] + im[b] * hr[b];
      re[b] = r; im[b] = m;
    }
    fft(re, im, true);
    for (let i = 0; i < nfft && s + i < out.length; i++) out[s + i] += re[i];
  }
  return out.subarray(0, y.length);
}

export function toneChain(y, s) {
  let x = biquad(y, biquadCoefs("highpass", s.hpf_hz, SR));
  x = biquad(x, biquadCoefs("lowshelf", 200, SR, { gainDb: s.warmth_db, q: 0.7 }));
  x = biquad(x, biquadCoefs("peaking", 350, SR, { gainDb: s.mud_db, q: 1.0 }));
  if (Math.abs(s.nasal_db || 0) > 0.01) x = biquad(x, biquadCoefs("peaking", 1000, SR, { gainDb: s.nasal_db, q: 1.2 }));
  x = biquad(x, biquadCoefs("peaking", 3000, SR, { gainDb: s.presence_db, q: 0.9 }));
  x = biquad(x, biquadCoefs("peaking", 6500, SR, { gainDb: s.harshness_db, q: 1.4 }));
  x = biquad(x, biquadCoefs("highshelf", 10000, SR, { gainDb: s.air_db, q: 0.7 }));
  x = compressor([x], s.comp_threshold_db, s.comp_ratio)[0];
  if (s.saturation_db > 0.1) x = saturate(x, s.saturation_db);
  if (s.reverb_mix > 0.001) {
    const wet = convolve(x, impulse(s.reverb_size)), dry = 1 - s.reverb_mix * 0.5;
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = x[i] * dry + wet[i] * s.reverb_mix;
    x = out;
  }
  return x;
}

// ---------------------------------------------------------------- per-layer polish
export function polishLayer(raw, type, s, grid) {
  const steps = [];
  let r = denoise(raw, s.denoise); steps.push(r.note); let y = r.out;
  if (s.timing_strength > 0) { r = tightenTiming(y, grid, s.timing_strength); steps.push(r.note); y = r.out; }
  y = toneChain(y, s);
  if (type === "vocal") { y = gateGaps(y, s.denoise); steps.push("gap noise gate"); }
  steps.push("tone chain (EQ, compression" + (s.saturation_db > 0.1 ? ", saturation" : "") + (s.reverb_mix > 0.001 ? ", reverb" : "") + ")");
  return { audio: y, steps };
}

// ---------------------------------------------------------------- song pass
function peakLimit(chans, ceiling) {
  const n = chans[0].length, g = new Float32Array(n);
  for (let i = 0; i < n; i++) { let p = 1e-9; for (const c of chans) p = Math.max(p, Math.abs(c[i])); g[i] = Math.min(1, ceiling / p); }
  const minFilter = (a, size) => {          // sliding minimum (simple deque)
    const out = new Float32Array(a.length), q = [], h = size >> 1;
    for (let i = 0; i < a.length + h; i++) {
      if (i < a.length) { while (q.length && a[q[q.length - 1]] >= a[i]) q.pop(); q.push(i); }
      const c = i - h;
      if (c >= 0) { while (q[0] < c - h) q.shift(); out[c] = a[q[0]]; }
    }
    return out;
  };
  let gg = minFilter(g, 2 * Math.round(0.005 * SR) + 1);
  gg = minFilter(gg, Math.round(0.06 * SR));
  const w = Math.round(0.005 * SR), sm = new Float32Array(n); let acc = 0;
  for (let i = 0; i < n; i++) { acc += gg[i] - (i >= w ? gg[i - w] : 0); sm[i] = Math.min(gg[i], acc / Math.min(i + 1, w)); }
  return chans.map((c) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = Math.max(-ceiling, Math.min(ceiling, c[i] * sm[i])); return o; });
}

/** layers: [{name, type, audio, pan}] -> {stereo:[L,R], actions[]} */
export function songPass(layers, { leadLufs = -18, supportLufs = -21.5, masterLufs = -14, ceilingDb = -1 } = {}) {
  const actions = [], n = Math.max(...layers.map((l) => l.audio.length));
  layers = layers.map((l) => { const a = new Float32Array(n); a.set(l.audio); return { ...l, audio: a }; });
  const vocals = layers.filter((l) => l.type === "vocal");
  if (vocals.length) {
    const vp = Math.max(...vocals.map((v) => bandShares(v.audio).presence));
    for (const l of layers) if (l.type !== "vocal") {
      const cut = Math.min(4, Math.max(0.5, (bandShares(l.audio).presence - vp + 6) / 2));
      l.audio = biquad(l.audio, biquadCoefs("peaking", 2800, SR, { gainDb: -cut, q: 1 }));
      actions.push(`${l.name}: −${cut.toFixed(1)} dB at 2.8 kHz to make room for the vocal`);
    }
  }
  if (layers.some((l) => l.type === "bass")) for (const l of layers) if (l.type.includes("guitar")) {
    l.audio = biquad(l.audio, biquadCoefs("highpass", 110, SR));
    actions.push(`${l.name}: low cut raised to 110 Hz to leave room for the bass`);
  }
  const leadType = vocals.length ? "vocal" : layers[0].type;
  let L = new Float32Array(n), R = new Float32Array(n);
  for (const l of layers) {
    const offset = l.level_db || 0;
    const target = (l.type === leadType ? leadLufs : supportLufs) + offset, cur = lufs([l.audio]);
    const g = cur > -60 ? target - cur : 0, lin = undb(g);
    const ang = ((l.pan + 1) * Math.PI) / 4, gl = Math.cos(ang) * lin, gr = Math.sin(ang) * lin;
    // pseudo-stereo width: a delayed, low-cut copy added to one side and subtracted from the other
    // (mono-compatible: it cancels when L and R are summed; lows stay centred)
    const w = l.width || 0;
    let side = null;
    if (w > 0.01) {
      const d = Math.round(0.011 * SR), dl = new Float32Array(n);
      for (let i = d; i < n; i++) dl[i] = l.audio[i - d];
      side = biquad(dl, biquadCoefs("highpass", 300, SR));
    }
    const sg = w * 0.5 * lin;
    for (let i = 0; i < n; i++) {
      const sd = side ? side[i] * sg : 0;
      L[i] += l.audio[i] * gl + sd; R[i] += l.audio[i] * gr - sd;
    }
    actions.push(`${l.name}: level ${g >= 0 ? "+" : ""}${g.toFixed(1)} dB (target ${target.toFixed(1)} LUFS${offset ? `, includes ${offset > 0 ? "+" : ""}${offset} dB requested` : ""})` + (w > 0.01 ? `, width ${Math.round(w * 100)}%` : ""));
  }
  [L, R] = compressor([L, R], -16, 2, 20, 200);
  actions.push("mix bus: glue compression 2:1");
  const ceiling = undb(ceilingDb);
  for (let it = 0; it < 3; it++) {
    const g = undb(masterLufs - lufs([L, R]));
    for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
    [L, R] = peakLimit([L, R], ceiling);
  }
  const final = lufs([L, R]);
  actions.push(`master: ${final.toFixed(1)} LUFS (target ${masterLufs}), peaks below ${ceilingDb} dBFS`);
  return { stereo: [L, R], actions, finalLufs: final };
}

// ---------------------------------------------------------------- whole session
/**
 * layers: [{name, type, raw: Float32Array (mono, 44.1 kHz)}], settings: {name: s}
 * onProgress(msg) is awaited between heavy steps so the page can repaint.
 */
export async function runSession(layers, settings, onProgress = async () => {}) {
  const log = { statement: "All output is the user's own recordings, edited and processed in this browser. No audio was generated, replaced or uploaded.", layers: {}, song: {} };
  await onProgress("Recognising tempo and key…");
  const master = layers[0];
  const { tempo, grid } = detectTempoGrid(master.raw);
  const n = Math.max(...layers.map((l) => l.raw.length)), sum = new Float32Array(n);
  for (const l of layers) for (let i = 0; i < l.raw.length; i++) sum[i] += l.raw[i];
  const key = detectKey(sum);
  log.song = { tempo_bpm: +tempo.toFixed(1), key, timing_master: master.name };
  const polished = [];
  for (const l of layers) {
    await onProgress(`Polishing ${l.name}…`);
    const s = settings[l.name], before = { describe: describe(l.raw) };
    if (l.type !== "vocal") {
      before.timing = timingReport(detectOnsets(l.raw).onsets, grid);
      before.chords = recogniseChords(l.raw, grid);
    }
    const { audio, steps } = polishLayer(l.raw, l.type, s, grid);
    const after = { describe: describe(audio) };
    if (l.type !== "vocal") after.timing = timingReport(detectOnsets(audio).onsets, grid);
    log.layers[l.name] = { sound_type: l.type, settings: { ...s }, steps, before, after };
    polished.push({ name: l.name, type: l.type, audio, pan: s.pan, width: s.width, level_db: s.level_db });
  }
  await onProgress("Song-level pass…");
  const { stereo, actions, finalLufs } = songPass(polished);
  log.song_pass = actions;
  log.song.master_lufs = +finalLufs.toFixed(1);
  // raw sum, loudness-matched to the polished mix so the A/B comparison is fair
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(sum[i]));
  let g = undb(lufs(stereo) - lufs([sum, sum]));
  if (pk * g > 0.99) g = 0.99 / pk;
  const rawMix = sum.map((v) => v * g);
  return { polished, mix: stereo, rawMix, log };
}

// ---------------------------------------------------------------- WAV
export function encodeWav(channels, sr = SR) {
  const n = channels[0].length, ch = channels.length, buf = new ArrayBuffer(44 + n * ch * 2), v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n * ch * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, channels[c][i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return buf;
}

export { SOUND_TYPES };
