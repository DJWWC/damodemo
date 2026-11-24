// File export: WAV (16/24-bit, 32-bit float), AIFF (24-bit), MP3 (128/192/320 kbps), and ZIP of several files.
// Everything is encoded on the device; nothing is uploaded.

export const FORMATS = {
  wav24:  { label: "WAV 24-bit (studio)", ext: "wav", mime: "audio/wav" },
  wav16:  { label: "WAV 16-bit (CD)", ext: "wav", mime: "audio/wav" },
  wav32f: { label: "WAV 32-bit float", ext: "wav", mime: "audio/wav" },
  aiff24: { label: "AIFF 24-bit (Logic / Pro Tools)", ext: "aif", mime: "audio/aiff" },
  mp3_320: { label: "MP3 320 kbps", ext: "mp3", mime: "audio/mpeg", kbps: 320 },
  mp3_192: { label: "MP3 192 kbps", ext: "mp3", mime: "audio/mpeg", kbps: 192 },
  mp3_128: { label: "MP3 128 kbps (small)", ext: "mp3", mime: "audio/mpeg", kbps: 128 },
};

const clip = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);

/** channels: array of Float32Array (1 = mono, 2 = stereo). bits: 16 | 24 | "32f" */
export function encodeWav(channels, sr, bits = 24) {
  const ch = channels.length, n = channels[0].length, float = bits === "32f";
  const bps = float ? 4 : bits / 8, dataLen = n * ch * bps;
  const buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf), u8 = new Uint8Array(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i); };
  str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bps * 8, true);
  str(36, "data"); v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = channels[c][i];
    if (float) { v.setFloat32(o, s, true); o += 4; }
    else if (bits === 16) { const x = clip(s); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
    else { let x = Math.round(clip(s) * 8388607); u8[o] = x & 255; u8[o + 1] = (x >> 8) & 255; u8[o + 2] = (x >> 16) & 255; o += 3; }
  }
  return u8;
}

/** AIFF, big-endian PCM. */
export function encodeAiff(channels, sr, bits = 24) {
  const ch = channels.length, n = channels[0].length, bps = bits / 8, dataLen = n * ch * bps;
  const total = 54 + dataLen, buf = new ArrayBuffer(total), v = new DataView(buf), u8 = new Uint8Array(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i); };
  str(0, "FORM"); v.setUint32(4, total - 8); str(8, "AIFF");
  str(12, "COMM"); v.setUint32(16, 18); v.setUint16(20, ch); v.setUint32(22, n); v.setUint16(26, bits);
  // sample rate as 80-bit IEEE extended
  let exp = 16383 + 31, mant = sr;
  while (!(mant & 0x80000000)) { mant <<= 1; mant >>>= 0; exp--; }
  v.setUint16(28, exp); v.setUint32(30, mant >>> 0); v.setUint32(34, 0);
  str(38, "SSND"); v.setUint32(42, dataLen + 8); v.setUint32(46, 0); v.setUint32(50, 0);
  let o = 54;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const x = clip(channels[c][i]);
    if (bits === 16) { v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff); o += 2; }
    else { const y = Math.round(x * 8388607); u8[o] = (y >> 16) & 255; u8[o + 1] = (y >> 8) & 255; u8[o + 2] = y & 255; o += 3; }
  }
  return u8;
}

// MP3 runs in its own background worker (the encoder is a classic script)
let mp3Worker = null, mp3Id = 0;
const mp3Jobs = new Map();
function mp3(channels, sr, kbps) {
  if (!mp3Worker) {
    mp3Worker = new Worker(new URL("./mp3worker.js", import.meta.url));
    mp3Worker.onmessage = (e) => { const j = mp3Jobs.get(e.data.id); mp3Jobs.delete(e.data.id); e.data.error ? j.reject(new Error(e.data.error)) : j.resolve(e.data.bytes); };
  }
  return new Promise((resolve, reject) => {
    const id = ++mp3Id; mp3Jobs.set(id, { resolve, reject });
    mp3Worker.postMessage({ id, channels: channels.map((c) => c.slice()), sr, kbps });
  });
}

/** Encode to the chosen format. Returns Promise<Uint8Array>. */
export async function encode(channels, sr, format) {
  const f = FORMATS[format];
  if (!f) throw new Error(`unknown format ${format}`);
  if (format === "wav16") return encodeWav(channels, sr, 16);
  if (format === "wav24") return encodeWav(channels, sr, 24);
  if (format === "wav32f") return encodeWav(channels, sr, "32f");
  if (format === "aiff24") return encodeAiff(channels, sr, 24);
  return mp3(channels, sr, f.kbps);
}

// ---------------------------------------------------------------- ZIP (stored, no compression)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** files: [{name, data: Uint8Array | string}] -> Uint8Array zip */
export function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cenLen = central.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cenLen, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

/** Pad (or keep) a mono track to length n so all exported layers line up from 0:00. */
export function padTo(arr, n) { if (arr.length === n) return arr; const out = new Float32Array(n); out.set(arr.subarray(0, n)); return out; }
