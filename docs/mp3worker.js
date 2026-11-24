// MP3 encoding in the background (lamejs, LGPL-3.0: vendor/lamejs-LICENSE.txt)
importScripts("vendor/lame.min.js");

self.onmessage = (e) => {
  const { id, channels, sr, kbps } = e.data;
  try {
    const ch = Math.min(2, channels.length), enc = new lamejs.Mp3Encoder(ch, sr, kbps);
    const toInt16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const x = Math.max(-1, Math.min(1, f[i])); o[i] = x < 0 ? x * 0x8000 : x * 0x7fff; } return o; };
    const L = toInt16(channels[0]), R = ch === 2 ? toInt16(channels[1]) : null;
    const chunks = [], block = 1152;
    for (let i = 0; i < L.length; i += block) {
      const out = ch === 2 ? enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block)) : enc.encodeBuffer(L.subarray(i, i + block));
      if (out.length) chunks.push(new Uint8Array(out));
    }
    const end = enc.flush(); if (end.length) chunks.push(new Uint8Array(end));
    const total = chunks.reduce((s, c) => s + c.length, 0), bytes = new Uint8Array(total);
    let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.length; }
    self.postMessage({ id, bytes }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
