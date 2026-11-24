// Non-destructive editing. A layer is a list of clips, each pointing at a
// stretch of an original recording (a "source"). Editing only changes the
// list; the recordings themselves are never altered.
//
// clip: { id, src, start, len, pos }   (all in samples)
//   src   - source id (which original recording)
//   start - where in the source the clip begins
//   len   - how long it is
//   pos   - where it sits on the timeline
//
// Clips on one layer never overlap: moving or pasting onto existing audio
// replaces what was there, like most audio editors.

let nextClipId = 1;
const newId = () => `c${nextClipId++}`;
export const FADE = 220;   // 5 ms fades at cut edges, so edits never click

export function wholeSource(src, length) {
  return [{ id: newId(), src, start: 0, len: length, pos: 0 }];
}

export const clone = (clips) => clips.map((c) => ({ ...c }));
export const sig = (clips) => clips.map((c) => `${c.src}:${c.start}:${c.len}:${c.pos}`).join("|");
export const end = (clips) => clips.reduce((m, c) => Math.max(m, c.pos + c.len), 0);
const sorted = (clips) => clips.sort((a, b) => a.pos - b.pos);

/** Remove [a, b) from the timeline (leaves a gap; nothing shifts). */
export function removeRange(clips, a, b) {
  const out = [];
  for (const c of clips) {
    const cs = c.pos, ce = c.pos + c.len;
    if (ce <= a || cs >= b) { out.push({ ...c }); continue; }
    if (cs < a) out.push({ ...c, id: newId(), len: a - cs });                                   // left piece
    if (ce > b) out.push({ ...c, id: newId(), start: c.start + (b - cs), len: ce - b, pos: b }); // right piece
  }
  return sorted(out);
}

/** Copy [a, b) as clipboard clips with positions relative to a. */
export function extract(clips, a, b) {
  const out = [];
  for (const c of clips) {
    const s = Math.max(a, c.pos), e = Math.min(b, c.pos + c.len);
    if (e <= s) continue;
    out.push({ id: newId(), src: c.src, start: c.start + (s - c.pos), len: e - s, pos: s - a });
  }
  return { clips: out, len: b - a };
}

/** Place clipboard at t, replacing whatever was there. */
export function paste(clips, board, t) {
  t = Math.max(0, Math.round(t));
  const cleared = removeRange(clips, t, t + board.len);
  return sorted([...cleared, ...board.clips.map((c) => ({ ...c, id: newId(), pos: c.pos + t }))]);
}

/** Split every clip that spans t into two. */
export function splitAt(clips, t) {
  t = Math.round(t);
  const out = [];
  for (const c of clips) {
    if (t > c.pos && t < c.pos + c.len) {
      out.push({ ...c, id: newId(), len: t - c.pos });
      out.push({ ...c, id: newId(), start: c.start + (t - c.pos), len: c.pos + c.len - t, pos: t });
    } else out.push({ ...c });
  }
  return sorted(out);
}

/** Move one clip so it starts at newPos, replacing audio it lands on. */
export function moveClip(clips, id, newPos) {
  const c = clips.find((x) => x.id === id);
  if (!c) return clips;
  newPos = Math.max(0, Math.round(newPos));
  const others = clips.filter((x) => x.id !== id);
  const cleared = removeRange(others, newPos, newPos + c.len);
  return sorted([...cleared, { ...c, pos: newPos }]);
}

export function deleteClip(clips, id) { return clips.filter((c) => c.id !== id); }

/** Duplicate [a, b) straight after itself. */
export function duplicate(clips, a, b) {
  const board = extract(clips, a, b);
  return { clips: paste(clips, board, b), pasted: [b, b + board.len] };
}

export function clipAt(clips, t) { return clips.find((c) => t >= c.pos && t < c.pos + c.len) || null; }

/** Render clips to audio. sources: Map(src -> Float32Array). */
export function flatten(clips, sources, minLength = 0) {
  const n = Math.max(minLength, end(clips)), out = new Float32Array(n);
  for (const c of clips) {
    const s = sources.get(c.src);
    if (!s) continue;
    const fadeIn = c.start > 0 ? Math.min(FADE, c.len >> 1) : 0;
    const fadeOut = c.start + c.len < s.length ? Math.min(FADE, c.len >> 1) : 0;
    for (let i = 0; i < c.len; i++) {
      let v = s[c.start + i] || 0;
      if (i < fadeIn) v *= i / fadeIn;
      else if (i >= c.len - fadeOut) v *= (c.len - 1 - i) / fadeOut;
      out[c.pos + i] += v;
    }
  }
  return out;
}

/** Nearest snap target to t within `range` samples, or null. targets sorted ascending. */
export function nearest(targets, t, range) {
  if (!targets || !targets.length) return null;
  let lo = 0, hi = targets.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (targets[m] < t) lo = m; else hi = m; }
  let best = null, bd = Infinity;
  for (const x of [targets[lo], targets[hi]]) { const d = Math.abs(x - t); if (d < bd) { bd = d; best = x; } }
  return bd <= range ? best : null;
}
