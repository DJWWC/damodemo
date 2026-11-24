// Timeline editor: one lane per layer, touch-first.
//   One finger:  Move tool  -> tap a clip to select it (and place the playhead), drag it to move
//                Select tool -> drag to select a time range on a lane
//                tap empty space or the ruler -> move the playhead
//   Two fingers: pinch to zoom, drag to scroll
//   Mouse:       same as one finger; wheel scrolls, Ctrl/Cmd + wheel zooms
import * as C from "./clips.js";

const SR = 44100;
const LABEL_W = 92, LANE_H = 64, RULER_H = 26, SNAP_PX = 16, DRAG_START_PX = 6;

export function createTimeline(root, api) {
  // api: layers(), position(), seek(sec), songLength(), grid(), onsetsFor(layer), edit([{layer, clips}]),
  //      undo(), redo(), canUndo(), canRedo(), onSelect()
  const view = { start: 0, pps: 0 };          // seconds at left edge, pixels per second
  const ui = { tool: "move", snap: "grid", gridRes: "beat", notes: true };
  let sel = null;                              // {type:"clip", layer, id} | {type:"range", layer, a, b}  (samples)
  let clipboard = null;                        // {board, from}
  let action = null, drag = null;              // current one-finger action, drag preview
  const pointers = new Map();
  let pinch = null, dirty = false;

  root.innerHTML = `
    <div class="tl-toolbar">
      <div class="ab tl-tools"><button data-tool="move" title="Move: tap a clip to select it, drag to move it">✋ Move</button><button data-tool="select" title="Select: drag across a lane to select a range">⇔ Select</button></div>
      <span class="tl-sep"></span>
      <button data-op="split" title="Split at the playhead (S)">✂ Split</button>
      <button data-op="cut" title="Cut (Ctrl/Cmd+X)">Cut</button>
      <button data-op="copy" title="Copy (Ctrl/Cmd+C)">Copy</button>
      <button data-op="paste" title="Paste at the playhead (Ctrl/Cmd+V)">Paste</button>
      <button data-op="duplicate" title="Duplicate straight after (Ctrl/Cmd+D)">⧉ Duplicate</button>
      <button data-op="delete" title="Delete (Delete key)">🗑 Delete</button>
      <span class="tl-sep"></span>
      <button data-op="undo" title="Undo (Ctrl/Cmd+Z)">↶ Undo</button>
      <button data-op="redo" title="Redo (Ctrl/Cmd+Shift+Z)">↷ Redo</button>
      <span class="tl-sep"></span>
      <label class="tl-snap">Snap <select data-k="snap">
        <option value="off">Off</option><option value="grid" selected>Beat grid</option>
        <option value="hits">Other tracks' hits</option><option value="both">Grid + hits</option></select></label>
      <label class="tl-snap">Grid <select data-k="gridRes"><option value="bar">Bar</option><option value="beat" selected>Beat</option><option value="half">½ beat</option></select></label>
      <span class="tl-sep"></span>
      <button data-op="notes" title="Show detected notes and chords on the lanes">🎵 Notes</button>
      <span class="tl-sep"></span>
      <button data-op="zoomout" title="Zoom out">−</button><button data-op="zoomin" title="Zoom in">+</button><button data-op="fit" title="Show the whole song">Fit</button>
    </div>
    <div class="tl-body">
      <div class="tl-ruler"><div class="tl-label"></div><canvas></canvas></div>
      <div class="tl-lanes"></div>
      <div class="tl-playhead"></div>
      <div class="tl-snapline"></div>
    </div>
    <input type="range" class="tl-scroll" min="0" max="1000" value="0" aria-label="Scroll timeline">
    <div class="tl-info"></div>`;
  const $ = (s) => root.querySelector(s);
  const body = $(".tl-body"), lanesEl = $(".tl-lanes"), rulerCanvas = $(".tl-ruler canvas");
  const playheadEl = $(".tl-playhead"), snapEl = $(".tl-snapline"), scrollEl = $(".tl-scroll"), infoEl = $(".tl-info");

  // ---------------------------------------------------------- geometry
  const areaW = () => Math.max(50, body.clientWidth - LABEL_W);
  const visSecs = () => areaW() / view.pps;
  const xToSec = (x) => view.start + x / view.pps;
  const secToX = (s) => (s - view.start) * view.pps;
  function fit() { const L = Math.max(1, api.songLength()); view.pps = areaW() / (L * 1.02); view.start = 0; }
  function clampView() {
    const L = Math.max(1, api.songLength());
    view.pps = Math.min(4000, Math.max(areaW() / (L * 1.05), view.pps));
    view.start = Math.max(0, Math.min(view.start, Math.max(0, L - visSecs() * 0.9)));
  }
  function zoomAround(sec, factor) {
    const x = secToX(sec); view.pps *= factor; clampView(); view.start = sec - x / view.pps; clampView(); invalidate();
  }

  // ---------------------------------------------------------- snapping
  function gridTargets() {
    const g = api.grid();
    if (!g) return [];
    const step = ui.gridRes === "bar" ? 8 : ui.gridRes === "beat" ? 2 : 1;   // grid holds half-beats
    const out = [];
    for (let i = 0; i < g.length; i += step) out.push(g[i]);
    return out;
  }
  function hitTargets(except) {
    const out = [];
    for (const l of api.layers()) if (l !== except) { const o = api.onsetsFor(l); if (o) out.push(...o); }
    return out.sort((a, b) => a - b);
  }
  function targets(except) {
    if (ui.snap === "off") return [];
    const t = [];
    if (ui.snap === "grid" || ui.snap === "both") t.push(...gridTargets());
    if (ui.snap === "hits" || ui.snap === "both") t.push(...hitTargets(except));
    return t.sort((a, b) => a - b);
  }
  const rangeSamples = () => (SNAP_PX / view.pps) * SR;
  function snapSample(s, except) {
    const hit = C.nearest(targets(except), s, rangeSamples());
    return hit === null ? { s, snapped: false } : { s: hit, snapped: true };
  }

  // ---------------------------------------------------------- lanes
  let laneEls = [];
  function buildLanes() {
    const ls = api.layers();
    lanesEl.innerHTML = "";
    laneEls = ls.map((l) => {
      const el = document.createElement("div");
      el.className = "tl-lane";
      el.innerHTML = `<div class="tl-label"><b>${l.name.replace(/</g, "&lt;")}</b><small></small></div><canvas></canvas>`;
      lanesEl.appendChild(el);
      return { l, el, canvas: el.querySelector("canvas"), small: el.querySelector("small") };
    });
    if (!view.pps) fit();
    invalidate();
  }
  function laneAt(clientY) {
    for (const le of laneEls) { const r = le.el.getBoundingClientRect(); if (clientY >= r.top && clientY < r.bottom) return le; }
    return null;
  }

  // ---------------------------------------------------------- drawing
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function sizeCanvas(c, h) {
    const dpr = window.devicePixelRatio || 1, w = areaW();
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + "px"; c.style.height = h + "px";
    }
    const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); return g;
  }
  function drawGrid(g, h) {
    const grid = api.grid();
    if (!grid || grid.length < 2) return;
    const w = areaW(), halfPx = view.pps * (grid[1] - grid[0]) / SR;
    for (let i = 0; i < grid.length; i++) {
      const bar = i % 8 === 0, beat = i % 2 === 0;
      if (!bar && !(beat && halfPx * 2 >= 8) && !(halfPx >= 14)) continue;
      const x = secToX(grid[i] / SR);
      if (x < -1 || x > w + 1) continue;
      g.fillStyle = bar ? "rgba(128,128,128,.38)" : beat ? "rgba(128,128,128,.2)" : "rgba(128,128,128,.09)";
      g.fillRect(Math.round(x), 0, 1, h);
    }
  }
  function drawRuler() {
    const g = sizeCanvas(rulerCanvas, RULER_H), w = areaW();
    g.clearRect(0, 0, w, RULER_H);
    g.fillStyle = css("--muted"); g.font = "11px system-ui, sans-serif";
    const grid = api.grid();
    if (grid && grid.length > 8) {
      const barPx = view.pps * (grid[8] - grid[0]) / SR, every = Math.max(1, Math.ceil(36 / barPx));
      for (let i = 0, bar = 1; i < grid.length; i += 8, bar++) {
        const x = secToX(grid[i] / SR);
        if (x < -20 || x > w) continue;
        g.fillRect(Math.round(x), RULER_H - 8, 1, 8);
        if ((bar - 1) % every === 0) g.fillText(String(bar), x + 3, 12);
      }
    } else {
      const step = [0.5, 1, 2, 5, 10, 30, 60].find((s) => s * view.pps > 50) || 60;
      for (let t = Math.ceil(view.start / step) * step; secToX(t) < w; t += step) {
        const x = secToX(t); g.fillRect(Math.round(x), RULER_H - 8, 1, 8); g.fillText(`${t.toFixed(step < 1 ? 1 : 0)}s`, x + 3, 12);
      }
    }
  }
  function drawLane(le) {
    const { l, canvas } = le, h = le.el.clientHeight || LANE_H, w = areaW(), g = sizeCanvas(canvas, h);
    g.clearRect(0, 0, w, h);
    drawGrid(g, h);
    const accent = css("--accent"), ink = css("--ink");
    const clips = drag && drag.layer === l ? drag.preview : l.clips;
    const selected = (c) => sel && sel.type === "clip" && sel.layer === l && sel.id === c.id;
    for (const c of clips) {
      const x0 = secToX(c.pos / SR), x1 = secToX((c.pos + c.len) / SR);
      if (x1 < 0 || x0 > w) continue;
      g.globalAlpha = selected(c) ? 0.32 : 0.14; g.fillStyle = accent;
      g.fillRect(x0, 2, x1 - x0, h - 4);
      g.globalAlpha = 1; g.strokeStyle = selected(c) ? ink : accent; g.lineWidth = selected(c) ? 2 : 1;
      g.strokeRect(x0 + 0.5, 2.5, Math.max(1, x1 - x0 - 1), h - 5);
    }
    // waveform of the edited audio (or the preview while dragging)
    const peaks = drag && drag.layer === l ? drag.peaks : l.peaks;
    if (peaks) {
      g.fillStyle = accent;
      const blk = peaks.block, spp = SR / view.pps, mid = h / 2, amp = h / 2 - 5;
      for (let x = 0; x < w; x++) {
        const s0 = (view.start * SR + x * spp) / blk, s1 = Math.max(s0 + 1, s0 + spp / blk);
        let m = 0;
        for (let i = Math.floor(s0); i < Math.min(peaks.data.length, Math.ceil(s1)); i++) if (peaks.data[i] > m) m = peaks.data[i];
        if (m > 0.002) g.fillRect(x, mid - m * amp, 1, Math.max(1, 2 * m * amp));
      }
    }
    const nd = ui.notes && !(drag && drag.layer === l) && api.notesFor ? api.notesFor(l) : null;
    if (nd && nd.notes.length) {
      // mini piano roll: pitch range of this layer mapped to the lane height
      let lo = Infinity, hi = -Infinity;
      for (const n of nd.notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
      const top = nd.chords.length ? 16 : 6, span = Math.max(6, hi - lo + 1), rowH = Math.max(1.5, (h - top - 6) / span);
      g.fillStyle = ink; g.globalAlpha = 0.55;
      for (const n of nd.notes) {
        const x0 = secToX(n.start), x1 = secToX(n.start + n.dur);
        if (x1 < 0 || x0 > w) continue;
        const y = h - 6 - (n.midi - lo + 1) * rowH;
        g.fillRect(x0, y, Math.max(1.5, x1 - x0), Math.max(1.5, rowH - 0.5));
      }
      g.globalAlpha = 1;
      if (nd.chords.length) {
        g.font = "600 11px system-ui, sans-serif"; g.textBaseline = "top";
        for (const c of nd.chords) {
          if (!c.chord) continue;
          const x = secToX(c.start); if (x > w || secToX(c.end) < 0) continue;
          const tw = g.measureText(c.chord).width + 8;
          g.fillStyle = css("--panel"); g.globalAlpha = 0.9; g.fillRect(Math.max(0, x) + 1, 2, tw, 13); g.globalAlpha = 1;
          g.fillStyle = ink; g.fillText(c.chord, Math.max(0, x) + 5, 3);
        }
      }
    }
    if (sel && sel.type === "range" && sel.layer === l) {
      const x0 = secToX(sel.a / SR), x1 = secToX(sel.b / SR);
      g.fillStyle = "rgba(60,120,220,.22)"; g.fillRect(x0, 0, x1 - x0, h);
      g.fillStyle = "rgba(60,120,220,.9)"; g.fillRect(x0, 0, 2, h); g.fillRect(x1 - 2, 0, 2, h);
    }
  }
  function draw() {
    dirty = false;
    clampView();
    drawRuler();
    for (const le of laneEls) drawLane(le);
    const L = Math.max(1, api.songLength()), span = Math.max(0, L - visSecs() * 0.9);
    if (document.activeElement !== scrollEl) scrollEl.value = span ? Math.round((view.start / span) * 1000) : 0;
    scrollEl.disabled = span <= 0;
    updatePlayhead();
    updateButtons();
    updateInfo();
  }
  function invalidate() { if (!dirty) { dirty = true; requestAnimationFrame(draw); } }
  function updatePlayhead() {
    const x = secToX(api.position()), w = areaW();
    playheadEl.style.display = x >= 0 && x <= w ? "block" : "none";
    playheadEl.style.left = `${LABEL_W + x}px`;
  }
  function showSnapLine(sample) {
    if (sample === null) { snapEl.style.display = "none"; return; }
    snapEl.style.display = "block"; snapEl.style.left = `${LABEL_W + secToX(sample / SR)}px`;
  }

  // ---------------------------------------------------------- selection helpers
  function selRange() {
    if (!sel) return null;
    if (sel.type === "range") return [sel.layer, sel.a, sel.b];
    const c = sel.layer.clips.find((x) => x.id === sel.id);
    return c ? [sel.layer, c.pos, c.pos + c.len] : null;
  }
  function updateButtons() {
    const has = !!selRange();
    const set = (op, on) => { const b = root.querySelector(`[data-op="${op}"]`); if (b) b.disabled = !on; };
    set("cut", has); set("copy", has); set("duplicate", has); set("delete", has);
    set("paste", !!clipboard); set("undo", api.canUndo()); set("redo", api.canRedo());
    set("split", api.layers().length > 0);
    root.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === ui.tool));
    const nb = root.querySelector('[data-op="notes"]'); if (nb) nb.classList.toggle("on", ui.notes);
  }
  function updateInfo() {
    const r = selRange();
    const fmt = (s) => (s / SR).toFixed(2) + " s";
    infoEl.textContent = r ? `Selected on ${r[0].name}: ${fmt(r[1])} → ${fmt(r[2])} (${fmt(r[2] - r[1])})` + (clipboard ? " · clipboard ready" : "")
      : (clipboard ? "Clipboard ready: tap where you want it, then Paste." : ui.tool === "move"
        ? "Move tool: tap a clip to select it, drag to move it. Tap empty space to move the playhead. Pinch to zoom, two fingers to scroll."
        : "Select tool: drag across a lane to select part of it. Then Cut, Copy, Duplicate or Delete.");
    for (const le of laneEls) le.small.textContent = api.statusFor ? api.statusFor(le.l) : "";
  }

  // ---------------------------------------------------------- edit operations
  const playheadSample = () => Math.round(api.position() * SR);
  function ops(op) {
    const r = selRange();
    if (op === "split") {
      const t = playheadSample(), ls = sel ? [sel.layer] : api.layers();
      const changes = ls.map((l) => ({ layer: l, clips: C.splitAt(l.clips, t) })).filter((c, i) => c.clips.length !== ls[i].clips.length);
      if (changes.length) api.edit(changes, "split");
      sel = null;
    } else if (op === "copy" || op === "cut") {
      if (!r) return;
      const [l, a, b] = r;
      clipboard = { board: C.extract(l.clips, a, b), from: l };
      if (op === "cut") { api.edit([{ layer: l, clips: C.removeRange(l.clips, a, b) }], "cut"); sel = null; }
    } else if (op === "paste") {
      if (!clipboard) return;
      const l = (sel && sel.layer) || clipboard.from;
      if (!l || !api.layers().includes(l)) return;
      const t = playheadSample();
      api.edit([{ layer: l, clips: C.paste(l.clips, clipboard.board, t) }], "paste");
      sel = { type: "range", layer: l, a: t, b: t + clipboard.board.len };
    } else if (op === "duplicate") {
      if (!r) return;
      const [l, a, b] = r, d = C.duplicate(l.clips, a, b);
      api.edit([{ layer: l, clips: d.clips }], "duplicate");
      sel = { type: "range", layer: l, a: d.pasted[0], b: d.pasted[1] };
    } else if (op === "delete") {
      if (!r) return;
      const [l, a, b] = r;
      api.edit([{ layer: l, clips: sel.type === "clip" ? C.deleteClip(l.clips, sel.id) : C.removeRange(l.clips, a, b) }], "delete");
      sel = null;
    } else if (op === "undo") { api.undo(); sel = null; }
    else if (op === "redo") { api.redo(); sel = null; }
    else if (op === "zoomin") zoomAround(api.position() >= view.start && api.position() <= view.start + visSecs() ? api.position() : view.start + visSecs() / 2, 1.6);
    else if (op === "zoomout") zoomAround(view.start + visSecs() / 2, 1 / 1.6);
    else if (op === "fit") fit();
    else if (op === "notes") ui.notes = !ui.notes;
    invalidate();
  }
  root.querySelectorAll("[data-op]").forEach((b) => (b.onclick = () => ops(b.dataset.op)));
  root.querySelectorAll("[data-tool]").forEach((b) => (b.onclick = () => { ui.tool = b.dataset.tool; invalidate(); }));
  root.querySelectorAll("select[data-k]").forEach((s) => (s.onchange = () => { ui[s.dataset.k] = s.value; invalidate(); }));
  scrollEl.oninput = () => {
    const L = Math.max(1, api.songLength()), span = Math.max(0, L - visSecs() * 0.9);
    view.start = (+scrollEl.value / 1000) * span; invalidate();
  };

  // ---------------------------------------------------------- pointer input (touch, pen, mouse)
  const area = body;
  area.style.touchAction = "none";
  const relX = (clientX) => clientX - area.getBoundingClientRect().left - LABEL_W;
  function onDown(e) {
    if (e.target === scrollEl) return;
    area.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {           // start pinch / two-finger pan; cancel the one-finger action
      cancelAction();
      const [p1, p2] = [...pointers.values()];
      pinch = { d0: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1, cx0: (p1.x + p2.x) / 2, pps0: view.pps, start0: view.start };
      pinch.sec0 = xToSec(relX(pinch.cx0));
      return;
    }
    if (pointers.size > 2) return;
    const x = relX(e.clientX);
    if (x < 0) return;                    // label column
    const inRuler = e.clientY - area.getBoundingClientRect().top < RULER_H;
    const sec = xToSec(x), s = Math.round(sec * SR);
    if (inRuler) { action = { type: "scrub" }; api.seek(Math.max(0, sec)); return; }
    const le = laneAt(e.clientY);
    if (!le) return;
    const l = le.l;
    if (ui.tool === "move") {
      const c = C.clipAt(l.clips, s);
      action = c ? { type: "clip", layer: l, clip: c, x0: e.clientX, s0: s, moved: false } : { type: "tap", layer: l, x0: e.clientX, s0: s };
    } else {
      const sn = snapSample(s, l).s;
      action = { type: "range", layer: l, x0: e.clientX, a: sn, b: sn };
    }
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1, cx = (p1.x + p2.x) / 2;
      view.pps = pinch.pps0 * (d / pinch.d0); clampView();
      view.start = pinch.sec0 - relX(cx) / view.pps; clampView();
      invalidate(); return;
    }
    if (!action) return;
    const x = relX(e.clientX), s = Math.round(xToSec(x) * SR);
    if (action.type === "scrub") { api.seek(Math.max(0, xToSec(x))); return; }
    if (action.type === "clip") {
      if (!action.moved && Math.abs(e.clientX - action.x0) < DRAG_START_PX) return;
      action.moved = true;
      const c = action.clip, l = action.layer;
      let pos = Math.max(0, c.pos + (s - action.s0)), snapAt = null;
      if (ui.snap !== "off") {
        // snap the clip's start, or its first hit, whichever lands closer to a target
        const tg = targets(l), range = rangeSamples();
        const own = (api.onsetsFor(l) || []).find((o) => o >= c.pos && o < c.pos + c.len);
        let best = null;
        const a = C.nearest(tg, pos, range);
        if (a !== null) best = { pos: a, d: Math.abs(a - pos), at: a };
        if (own !== undefined) {
          const off = own - c.pos, b = C.nearest(tg, pos + off, range);
          if (b !== null && (!best || Math.abs(b - (pos + off)) < best.d)) best = { pos: b - off, d: Math.abs(b - (pos + off)), at: b };
        }
        if (best) { pos = Math.max(0, best.pos); snapAt = best.at; }
      }
      const preview = C.moveClip(l.clips, c.id, pos);
      drag = { layer: l, preview, peaks: api.peaksFor(preview), pos };
      sel = { type: "clip", layer: l, id: c.id };
      showSnapLine(snapAt);
      invalidate();
    } else if (action.type === "range") {
      if (!action.moved && Math.abs(e.clientX - action.x0) < DRAG_START_PX) return;
      action.moved = true;
      const sn = snapSample(Math.max(0, s), action.layer);
      action.b = sn.s; showSnapLine(sn.snapped ? sn.s : null);
      sel = { type: "range", layer: action.layer, a: Math.min(action.a, action.b), b: Math.max(action.a, action.b) };
      invalidate();
    }
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (!action) return;
    const a = action; action = null; showSnapLine(null);
    if (a.type === "clip") {
      if (a.moved && drag) {
        api.edit([{ layer: a.layer, clips: drag.preview }], "move");
        drag = null;
      } else {
        sel = { type: "clip", layer: a.layer, id: a.clip.id };
        api.seek(snapSample(a.s0, a.layer).s / SR);
      }
    } else if (a.type === "tap") {
      sel = null; api.seek(snapSample(a.s0, a.layer).s / SR);
    } else if (a.type === "range") {
      // a tap (no drag) in Select mode clears the selection and moves the playhead
      if (!a.moved || !sel || sel.type !== "range" || sel.b - sel.a < (4 / view.pps) * SR) { sel = null; api.seek(Math.max(0, a.a) / SR); }
    }
    invalidate();
    api.onSelect?.();
  }
  function cancelAction() { action = null; drag = null; showSnapLine(null); invalidate(); }
  area.addEventListener("pointerdown", onDown);
  area.addEventListener("pointermove", onMove);
  area.addEventListener("pointerup", onUp);
  area.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); pinch = null; cancelAction(); });
  area.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAround(xToSec(relX(e.clientX)), Math.exp(-e.deltaY * 0.003));
    else { view.start += (e.deltaX || e.deltaY) / view.pps; clampView(); invalidate(); }
  }, { passive: false });
  // stop iPad Safari treating gestures on the timeline as page zoom
  ["gesturestart", "gesturechange"].forEach((ev) => area.addEventListener(ev, (e) => e.preventDefault()));

  document.addEventListener("keydown", (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || !api.layers().length) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    const map = { x: "cut", c: "copy", v: "paste", d: "duplicate", z: e.shiftKey ? "redo" : "undo", y: "redo" };
    if (mod && map[k]) { e.preventDefault(); ops(map[k]); }
    else if (!mod && k === "s") ops("split");
    else if (!mod && (k === "delete" || k === "backspace")) { e.preventDefault(); ops("delete"); }
  });
  new ResizeObserver(() => invalidate()).observe(body);

  return {
    rebuild: buildLanes,
    redraw: invalidate,
    tick(follow) {
      updatePlayhead();
      if (!follow || action || pinch) return;
      // keep the playhead in view while playing
      const p = api.position();
      if (p > view.start + visSecs() * 0.95 || p < view.start) { view.start = Math.max(0, p - visSecs() * 0.1); invalidate(); }
    },
    clearSelection() { sel = null; invalidate(); },
    dropLayer(l) { if (sel && sel.layer === l) sel = null; if (clipboard && clipboard.from === l) clipboard.from = null; },
    fit() { fit(); invalidate(); },
    get view() { return { ...view }; },   // for tests
  };
}
