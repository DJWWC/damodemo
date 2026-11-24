import { PARAMS, SOUND_TYPES, PRESETS, defaultSettings } from "./settings.js";
import { interpret, INTERPRETER_VERSION } from "./interpret.js";
import { SR, encodeWav, lufs } from "./engine.js";
import { demoGuitar, demoVocal } from "./demo.js";
import * as C from "./clips.js";
import { createTimeline } from "./timeline.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const MIX_PARAMS = new Set(["pan", "width", "level_db"]);   // used only when mixing; no re-polish needed
const LEAD_LUFS = -18, SUPPORT_LUFS = -21.5;

/** layer: {id, name, type, raw, rawLufs, settings, baseline, polished, report, polishedSig, busy, use, mute, solo, history} */
const state = { layers: [], analysis: null, final: null, sources: new Map(), sourcePeaks: new Map() };
const history = { undo: [], redo: [] };
let nextId = 1;

// ------------------------------------------------------------------ background worker
const worker = new Worker("worker.js", { type: "module" });
let jobId = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const { id, result, error } = e.data, p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  error ? p.reject(new Error(error.split("\n")[0])) : p.resolve(result);
};
const run = (cmd, args, transfer = []) => new Promise((resolve, reject) => {
  const id = ++jobId; pending.set(id, { resolve, reject }); worker.postMessage({ id, cmd, ...args }, transfer);
});

// ------------------------------------------------------------------ layers
function guessType(name) {
  const n = name.toLowerCase();
  if (/vocal|vox|voice|sing|lead/.test(n)) return "vocal";
  if (/bass/.test(n)) return "bass";
  if (/elec|dist|amp/.test(n)) return "electric_guitar";
  return "acoustic_guitar";
}
function uniqueName(base, except) {
  base = base.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "layer";
  let n = base, i = 2;
  while (state.layers.some((l) => l !== except && l.name === n)) n = `${base}${i++}`;
  return n;
}
function addLayer(name, type, raw) {
  const s = defaultSettings(type, $("preset").value), id = nextId++, src = `s${id}`;
  state.sources.set(src, raw);
  state.sourcePeaks.set(src, blockPeaks(raw));
  const l = { id, name: uniqueName(name), type, source: raw, settings: s, baseline: { ...s }, clips: C.wholeSource(src, raw.length),
    polished: null, report: null, polishedSig: null, busy: false, use: "raw", mute: false, solo: false, history: [], editVer: 0 };
  state.layers.push(l);
  reflatten(l);
  invalidateAnalysis();
  renderAll();
  timeline.fit();
  background();
}

// ------------------------------------------------------------------ editing (non-destructive clips)
const PEAK_BLOCK = 128;
function blockPeaks(arr) {
  const n = Math.ceil(arr.length / PEAK_BLOCK), out = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let m = 0;
    for (let i = b * PEAK_BLOCK, e = Math.min(arr.length, i + PEAK_BLOCK); i < e; i++) { const v = Math.abs(arr[i]); if (v > m) m = v; }
    out[b] = m;
  }
  return out;
}
/** Waveform overview for a clip list, built from the sources' peaks (fast enough to redo on every drag move). */
function peaksFor(clips) {
  const n = Math.ceil(C.end(clips) / PEAK_BLOCK), data = new Float32Array(n);
  for (const c of clips) {
    const sp = state.sourcePeaks.get(c.src);
    if (!sp) continue;
    const off = Math.floor(c.start / PEAK_BLOCK), at = Math.floor(c.pos / PEAK_BLOCK), len = Math.ceil(c.len / PEAK_BLOCK);
    for (let i = 0; i < len && at + i < n; i++) data[at + i] = Math.max(data[at + i], sp[off + i] || 0);
  }
  return { block: PEAK_BLOCK, data };
}
function reflatten(l) {
  l.raw = C.flatten(l.clips, state.sources);
  l.rawLufs = lufs([l.raw]);
  l.peaks = peaksFor(l.clips);
  l.clipSig = C.sig(l.clips);
  l.onsets = null;
  l.editVer++;
}
const snapshot = () => state.layers.map((l) => ({ l, clips: C.clone(l.clips) }));
function restore(snap) {
  for (const { l, clips } of snap) {
    if (!state.layers.includes(l) || C.sig(clips) === C.sig(l.clips)) continue;
    l.clips = clips; reflatten(l);
  }
  afterEdit();
}
function edit(changes, label) {
  history.undo.push({ label, snap: snapshot() });
  if (history.undo.length > 100) history.undo.shift();
  history.redo = [];
  for (const { layer, clips } of changes) { layer.clips = clips; reflatten(layer); }
  afterEdit();
}
function undo() { const h = history.undo.pop(); if (!h) return; history.redo.push({ label: h.label, snap: snapshot() }); restore(h.snap); }
function redo() { const h = history.redo.pop(); if (!h) return; history.undo.push({ label: h.label, snap: snapshot() }); restore(h.snap); }
function afterEdit() {
  invalidateAnalysis();
  renderAll();
  if (player.playing) restartPlayback();
  background();
}
const editedSincePolish = (l) => !!l.polished && l.polishedClips !== l.clipSig;
const effectiveUse = (l) => (l.use === "pol" && l.polished && !editedSincePolish(l) ? "pol" : "raw");

// tempo grid and per-layer hits for snapping, worked out in the background after changes
let bgTimer = null;
function background() {
  clearTimeout(bgTimer);
  bgTimer = setTimeout(async () => {
    if (!state.layers.length) return;
    try {
      await ensureAnalysis();
      for (const l of [...state.layers]) {
        if (l.onsets) continue;
        const ver = l.editVer, r = await run("onsets", { audio: l.raw });
        if (l.editVer === ver) l.onsets = Array.from(r.onsets);
      }
      timeline.redraw();
    } catch (err) { console.warn(err); }
  }, 250);
}
async function decode(file) {
  let buf = await audioCtx().decodeAudioData(await file.arrayBuffer());
  if (buf.sampleRate !== SR) {
    // iPads and most phones run audio at 48 kHz; the engine works at 44.1 kHz
    const off = new OfflineAudioContext(buf.numberOfChannels, Math.ceil(buf.duration * SR), SR);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    buf = await off.startRendering();
  }
  const n = buf.length, mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  return mono;
}

// tempo grid + key: from the first layer (timing master) and all layers
// The beat grid comes from the timing master's ORIGINAL recording, so it stays put while you edit.
const analysisKey = () => state.layers.length ? `${state.layers[0].id}|${state.layers.map((l) => l.id).sort().join(",")}` : "";
function invalidateAnalysis() { if (state.analysis && state.analysis.cacheKey !== analysisKey()) state.analysis = null; }
async function ensureAnalysis() {
  const cacheKey = analysisKey();
  if (state.analysis && state.analysis.cacheKey === cacheKey) return state.analysis;
  const r = await run("analyse", { master: state.layers[0].source, all: state.layers.map((l) => l.source) });
  state.analysis = { ...r, cacheKey, masterId: state.layers[0].id };
  return state.analysis;
}

const polishSig = (l) => JSON.stringify(Object.entries(l.settings).filter(([k]) => !MIX_PARAMS.has(k)).map(([k, v]) => [k, +v.toFixed(4)]))
  + `|${l.type}|${state.layers[0]?.id}|${l.clipSig}`;
function status(l) {
  if (l.busy) return ["busy", "Polishing…"];
  if (!l.polished) return ["", "Not polished"];
  if (editedSincePolish(l)) return ["stale", "Edited: re-polish"];
  if (l.polishedSig !== polishSig(l)) return ["stale", "Changed: re-polish"];
  return ["ok", "Polished ✓"];
}

async function polishLayer(l) {
  if (l.busy) return;
  l.busy = true; renderAll();
  try {
    const a = await ensureAnalysis();
    const sig = polishSig(l), clipSig = l.clipSig;
    const r = await run("polish", { raw: l.raw.slice(), type: l.type, settings: { ...l.settings }, grid: a.grid });
    l.polished = r.audio; l.report = r; l.polishedSig = sig; l.polishedClips = clipSig; l.polLufs = r.after.describe.lufs; l.use = "pol";
  } catch (err) {
    alert(`Couldn't polish ${l.name}: ${err.message}`);
  } finally {
    l.busy = false;
    renderAll();
    if (player.playing) restartPlayback();
  }
}

// ------------------------------------------------------------------ rendering: layer cards
function renderAll() { renderLayers(); renderMixer(); renderTransport(); timeline.rebuild(); }

function renderLayers() {
  const box = $("layers");
  box.innerHTML = state.layers.length ? "" : '<div class="empty">No layers yet. Add your takes, or load the demo to try it.</div>';
  state.layers.forEach((l, idx) => {
    const [cls, label] = status(l);
    const el = document.createElement("div");
    el.className = "layer";
    const typeOpts = Object.entries(SOUND_TYPES).map(([k, v]) => `<option value="${k}" ${k === l.type ? "selected" : ""}>${v.label}</option>`).join("");
    const rep = l.report ? reportLine(l) : "";
    el.innerHTML = `
      <div class="row">
        <input type="text" value="${esc(l.name)}" title="Name used in requests" data-k="name">
        <select data-k="type">${typeOpts}</select>
        <span class="meta">${(l.raw.length / SR).toFixed(1)} s</span>
        ${idx === 0 ? '<span class="master" title="Its tempo sets the beat grid for timing correction">timing master</span>' : '<button class="small" data-act="first" title="Use this layer\'s tempo for timing correction">make timing master</button>'}
        <span style="flex:1"></span>
        <button class="small" data-act="del">Remove</button>
      </div>
      <div class="row" style="margin-top:8px">
        <span class="status ${cls}">${label}</span>
        <button class="small ${cls === "ok" ? "" : "primary"}" data-act="polish" ${l.busy ? "disabled" : ""}>${l.polished ? "Re-polish" : "Polish this layer"}</button>
        <button class="small" data-act="solo-play" title="Play just this layer">${player.playing && soloPreview === l ? "■ Stop" : "▶ Play this layer"}</button>
        ${l.polished ? '<button class="small" data-act="dl">⬇ WAV</button>' : ""}
      </div>
      <div class="prompt-row">
        <input type="text" placeholder="Describe changes for ${esc(l.name)}: e.g. warmer, less nasal, tighter, drier" data-k="prompt">
        <button class="small" data-act="apply">Apply</button>
      </div>
      <ul class="changes">${l.history.slice(0, 3).map(historyItem).join("")}</ul>
      ${rep}
      <details ${l.knobsOpen ? "open" : ""}><summary>Knobs (what presets and requests change)</summary><div class="knobs"></div></details>`;
    const nameIn = el.querySelector('[data-k="name"]');
    nameIn.onchange = () => { l.name = uniqueName(nameIn.value, l); renderAll(); };
    el.querySelector('[data-k="type"]').onchange = (e) => {
      l.type = e.target.value; l.settings = defaultSettings(l.type, $("preset").value); l.baseline = { ...l.settings }; renderAll();
    };
    const pIn = el.querySelector('[data-k="prompt"]');
    const applyLayer = () => {
      const text = pIn.value.trim();
      if (!text) return;
      const res = interpret(text, { [l.name]: l }, { [l.name]: l.settings }, { [l.name]: l.baseline });
      l.history.unshift({ text, ...res });
      applyLiveMix();
      renderAll();
    };
    pIn.onkeydown = (e) => { if (e.key === "Enter") applyLayer(); };
    el.querySelector("details").ontoggle = (e) => { l.knobsOpen = e.target.open; };
    el.querySelectorAll("button[data-act]").forEach((b) => (b.onclick = () => {
      const act = b.dataset.act;
      if (act === "apply") applyLayer();
      if (act === "polish") polishLayer(l);
      if (act === "del") { stopPlayback(); timeline.dropLayer(l); state.layers.splice(state.layers.indexOf(l), 1); invalidateAnalysis(); renderAll(); background(); }
      if (act === "first") { stopPlayback(); state.layers.splice(state.layers.indexOf(l), 1); state.layers.unshift(l); invalidateAnalysis(); renderAll(); background(); }
      if (act === "solo-play") togglePreview(l);
      if (act === "dl") download(encodeWav([l.polished]), `${l.name}_polished.wav`);
    }));
    const knobs = el.querySelector(".knobs");
    for (const [p, [lo, hi, desc]] of Object.entries(PARAMS)) {
      if (p === "timing_strength" && l.type === "vocal") continue;
      const v = l.settings[p], changed = Math.abs(v - l.baseline[p]) > 1e-6;
      const k = document.createElement("label");
      k.className = "knob" + (changed ? " changed" : "");
      k.title = desc + (MIX_PARAMS.has(p) ? " (mix setting: no re-polish needed)" : "");
      const step = hi - lo > 20 ? 1 : (hi - lo) / 100;
      k.innerHTML = `<span>${p.replace(/_/g, " ")}</span><input type="range" min="${lo}" max="${hi}" step="${step}" value="${v}"><span>${fmt(v)}</span>`;
      const input = k.querySelector("input");
      input.oninput = () => {
        l.settings[p] = +input.value; k.lastChild.textContent = fmt(+input.value); k.classList.add("changed");
        if (MIX_PARAMS.has(p)) { applyLiveMix(); renderMixer(); } else refreshStatus(el, l);
      };
      knobs.appendChild(k);
    }
    box.appendChild(el);
  });
  $("render").disabled = !state.layers.length;
}
function refreshStatus(el, l) {
  const [cls, label] = status(l), s = el.querySelector(".status");
  s.className = `status ${cls}`; s.textContent = label;
  renderMixer();
}
const fmt = (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2));
function historyItem(h) {
  return `<li><b>“${esc(h.text)}”</b>` + (h.changes.length ? "<ul>" + h.changes.map((c) => `<li><code>${esc(c.text)}</code></li>`).join("") + "</ul>" : "")
    + h.notes.map((n) => `<div class="note">${esc(n)}</div>`).join("") + "</li>";
}
function reportLine(l) {
  const b = l.report.before, a = l.report.after, parts = [];
  if (b.timing) parts.push(`timing <b>${b.timing.mean_ms} → ${a.timing.mean_ms} ms</b> from the beat`);
  const qa = a.describe.quietest_db;
  parts.push(`hiss/gaps <b>${b.describe.quietest_db} → ${qa < -90 ? "silent" : qa + " dB"}</b>`);
  if (b.chords?.length) parts.push(`chords heard: <b>${b.chords.slice(0, 8).map((c) => c.chord).join(" ")}</b>`);
  return `<div class="report">${parts.join(" · ")}<br><span style="font-size:12px">${esc(l.report.steps.join(" · "))}</span></div>`;
}

// ------------------------------------------------------------------ overall style
$("preset").innerHTML = Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
$("preset").onchange = () => {
  for (const l of state.layers) {
    const keep = Object.fromEntries([...MIX_PARAMS].map((p) => [p, l.settings[p]]));
    l.settings = { ...defaultSettings(l.type, $("preset").value), ...keep };
    l.baseline = { ...l.settings };
  }
  $("changes").innerHTML = "";
  renderAll();
};
const EXAMPLES = ["vocal: warmer and less harsh", "the vocal sounds a bit nasal", "guitar is too bright", "I can't hear the vocal",
  "guitar: tighter and wider", "make it more vintage", "vocal: no reverb", "dreamy guitar"];
$("chips").innerHTML = EXAMPLES.map((e) => `<span class="chip">${e}</span>`).join("");
$("chips").onclick = (e) => { if (e.target.classList.contains("chip")) { $("prompt").value = e.target.textContent; applyGlobal(); } };
function applyGlobal() {
  const text = $("prompt").value.trim();
  if (!text) return;
  if (!state.layers.length) { $("changes").innerHTML = "<li>Add a layer first.</li>"; return; }
  const byName = Object.fromEntries(state.layers.map((l) => [l.name, l]));
  const res = interpret(text, byName, Object.fromEntries(state.layers.map((l) => [l.name, l.settings])),
    Object.fromEntries(state.layers.map((l) => [l.name, l.baseline])));
  const li = document.createElement("li");
  li.innerHTML = historyItem({ text, ...res }).replace(/^<li>|<\/li>$/g, "");
  $("changes").prepend(li);
  if (res.changes.length) $("prompt").value = "";
  applyLiveMix();
  renderAll();
}
$("apply").onclick = applyGlobal;
$("prompt").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); applyGlobal(); } };

// ------------------------------------------------------------------ add files / demo
$("add").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  for (const f of e.target.files) {
    try { addLayer(f.name, guessType(f.name), await decode(f)); }
    catch { alert(`Couldn't read ${f.name}. Try WAV or MP3.`); }
  }
  e.target.value = "";
};
$("demo").onclick = () => {
  $("mix-progress").textContent = "Generating demo takes…";
  setTimeout(() => {
    addLayer("guitar", "acoustic_guitar", demoGuitar());
    addLayer("vocal", "vocal", demoVocal());
    $("mix-progress").textContent = "Demo loaded: a sloppy strummed guitar and an off-pitch, hissy synth “vocal”. Press ▶ Play to hear them raw.";
  }, 20);
};

// ------------------------------------------------------------------ mixer UI
function renderMixer() {
  const box = $("mixer");
  if (!state.layers.length) { box.innerHTML = '<div class="empty">Add layers to use the mixer.</div>'; return; }
  const grid = document.createElement("div");
  grid.className = "mixer";
  grid.innerHTML = `<span class="h">Layer</span><span class="h">Mute</span><span class="h">Solo</span><span class="h">Version</span><span class="h wide-h">Volume</span><span class="h wide-h">Pan</span>`;
  for (const l of state.layers) {
    const [cls, label] = status(l);
    const row = document.createElement("div");
    row.style.display = "contents";
    row.innerHTML = `
      <span class="name" title="${esc(l.name)}">${esc(l.name)}<small><span class="status ${cls}" style="padding:0 6px">${label}</span></small></span>
      <button class="toggle m ${l.mute ? "on" : ""}" data-act="mute" title="Mute">M</button>
      <button class="toggle s ${l.solo ? "on" : ""}" data-act="solo" title="Solo">S</button>
      <div class="ab small"><button data-act="raw" class="${effectiveUse(l) === "raw" ? "on" : ""}">Raw</button><button data-act="pol" class="${effectiveUse(l) === "pol" ? "on" : ""}" ${l.polished && !editedSincePolish(l) ? "" : `disabled title='${l.polished ? "Re-polish after editing" : "Polish this layer first"}'`}>Polished</button></div>
      <label class="slider wide"><input type="range" min="-12" max="12" step="0.5" value="${l.settings.level_db}" data-k="level_db" aria-label="${esc(l.name)} volume"><span>${l.settings.level_db > 0 ? "+" : ""}${(+l.settings.level_db).toFixed(1)} dB</span></label>
      <label class="slider wide pan"><input type="range" min="-1" max="1" step="0.05" value="${l.settings.pan}" data-k="pan" aria-label="${esc(l.name)} pan"><span>${panLabel(l.settings.pan)}</span></label>`;
    row.querySelectorAll("button[data-act]").forEach((b) => (b.onclick = () => {
      const a = b.dataset.act;
      if (a === "mute") l.mute = !l.mute;
      if (a === "solo") l.solo = !l.solo;
      if (a === "raw") l.use = "raw";
      if (a === "pol" && l.polished && !editedSincePolish(l)) l.use = "pol";
      applyLiveMix(); renderMixer();
    }));
    row.querySelectorAll("input[data-k]").forEach((inp) => {
      inp.oninput = () => {
        const k = inp.dataset.k;
        l.settings[k] = +inp.value;
        inp.nextElementSibling.textContent = k === "pan" ? panLabel(+inp.value) : `${+inp.value > 0 ? "+" : ""}${(+inp.value).toFixed(1)} dB`;
        applyLiveMix();
      };
      inp.onchange = () => renderLayers();
    });
    grid.appendChild(row);
  }
  box.innerHTML = "";
  box.appendChild(grid);
}
const panLabel = (p) => (Math.abs(p) < 0.025 ? "C" : `${Math.round(Math.abs(p) * 100)}${p < 0 ? "L" : "R"}`);
$("all-raw").onclick = () => { state.layers.forEach((l) => (l.use = "raw")); applyLiveMix(); renderMixer(); };
$("all-pol").onclick = () => { state.layers.forEach((l) => l.polished && (l.use = "pol")); applyLiveMix(); renderMixer(); };
$("polish-all").onclick = async () => {
  const todo = state.layers.filter((l) => status(l)[0] !== "ok");
  if (!todo.length) { $("mix-progress").textContent = "All layers are already polished."; return; }
  for (const [i, l] of todo.entries()) { $("mix-progress").textContent = `Polishing ${l.name} (${i + 1}/${todo.length})…`; await polishLayer(l); }
  $("mix-progress").textContent = "Done.";
};

// ------------------------------------------------------------------ live playback (all layers in sync)
let ctx = null;
const audioCtx = () => (ctx ??= new AudioContext());
const player = { playing: false, startCtx: 0, offset: 0, nodes: new Map(), master: null };
let soloPreview = null;   // layer played alone from its card
const songLength = () => Math.max(0, ...state.layers.map((l) => l.raw.length)) / SR;
const bufCache = new WeakMap();
function bufferFor(arr) {
  if (!bufCache.has(arr)) { const b = audioCtx().createBuffer(1, arr.length, SR); b.copyToChannel(arr, 0); bufCache.set(arr, b); }
  return bufCache.get(arr);
}
const undb = (d) => 10 ** (d / 20);
function autoGain(l, which) {
  // same balance targets as the final render, so what you hear is close to what you get
  const hasVocal = state.layers.some((x) => x.type === "vocal");
  const lead = hasVocal ? l.type === "vocal" : l === state.layers[0];
  const target = (lead ? LEAD_LUFS : SUPPORT_LUFS) + (l.settings.level_db || 0);
  const cur = which === "pol" ? l.polLufs : l.rawLufs;
  return cur > -60 ? undb(target - cur) : 1;
}
function audible(l) {
  if (soloPreview) return l === soloPreview;
  const anySolo = state.layers.some((x) => x.solo);
  return anySolo ? l.solo : !l.mute;
}
function applyLiveMix() {
  if (!player.playing) return;
  const t = audioCtx().currentTime;
  for (const l of state.layers) {
    const n = player.nodes.get(l);
    if (!n) continue;
    const on = audible(l) ? 1 : 0;
    const use = effectiveUse(l);
    n.rawG.gain.setTargetAtTime(use === "raw" ? autoGain(l, "raw") * on : 0, t, 0.015);
    if (n.polG) n.polG.gain.setTargetAtTime(use === "pol" ? autoGain(l, "pol") * on : 0, t, 0.015);
    n.pan.pan.setTargetAtTime(l.settings.pan || 0, t, 0.015);
  }
}
function startPlayback(offset) {
  const ac = audioCtx(); ac.resume();
  stopNodes();
  player.master = ac.createGain(); player.master.gain.value = 0.5;     // headroom while previewing
  const lim = ac.createDynamicsCompressor(); lim.threshold.value = -3; lim.ratio.value = 12; lim.attack.value = 0.002;
  player.master.connect(lim).connect(ac.destination);
  const when = ac.currentTime + 0.05;
  for (const l of state.layers) {
    const pan = ac.createStereoPanner(); pan.connect(player.master);
    const mk = (arr) => {
      const src = ac.createBufferSource(), g = ac.createGain(); g.gain.value = 0;
      src.buffer = bufferFor(arr); src.connect(g).connect(pan);
      if (offset < arr.length / SR) src.start(when, offset);
      return { src, g };
    };
    const r = mk(l.raw), p = l.polished && !editedSincePolish(l) ? mk(l.polished) : null;
    player.nodes.set(l, { rawSrc: r.src, rawG: r.g, polSrc: p?.src, polG: p?.g, pan });
  }
  player.playing = true; player.startCtx = when; player.offset = offset;
  applyLiveMix();
  tick();
}
function stopNodes() {
  for (const n of player.nodes.values()) { try { n.rawSrc.stop(); } catch {} try { n.polSrc?.stop(); } catch {} }
  player.nodes.clear();
  if (player.master) { try { player.master.disconnect(); } catch {} player.master = null; }
}
function position() { return player.playing ? player.offset + Math.max(0, audioCtx().currentTime - player.startCtx) : player.offset; }
function stopPlayback() {
  if (!player.playing) return;
  player.offset = position(); stopNodes(); player.playing = false; soloPreview = null; renderAll();
}
function restartPlayback() { startPlayback(position()); }
function togglePreview(l) {
  if (player.playing && soloPreview === l) { stopPlayback(); return; }
  stopFinal();
  const from = player.playing ? position() : player.offset >= songLength() - 0.05 ? 0 : player.offset;
  soloPreview = l;
  startPlayback(from);
  renderAll();
}
$("play").onclick = () => {
  if (player.playing) { stopPlayback(); return; }
  stopFinal();
  soloPreview = null;
  if (player.offset >= songLength() - 0.05) player.offset = 0;
  startPlayback(player.offset);
  renderAll();
};
function seekTo(t) {
  t = Math.max(0, Math.min(t, songLength()));
  if (player.playing) startPlayback(t); else { player.offset = t; renderTransport(); }
  timeline.redraw();
}
$("seek").oninput = () => seekTo((+$("seek").value / 1000) * songLength());
function fmtTime(s) { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`; }
function renderTransport() {
  $("transport").hidden = !state.layers.length;
  const len = songLength(), pos = Math.min(position(), len);
  $("play").textContent = player.playing ? (soloPreview ? `■ Stop (${soloPreview.name})` : "■ Stop") : "▶ Play";
  if (document.activeElement !== $("seek")) $("seek").value = len ? Math.round((pos / len) * 1000) : 0;
  $("time").textContent = `${fmtTime(pos)} / ${fmtTime(len)}`;
  timeline.tick(player.playing);
}
function tick() {
  if (!player.playing) return;
  if (position() >= songLength()) { player.offset = 0; stopNodes(); player.playing = false; soloPreview = null; renderAll(); return; }
  renderTransport();
  requestAnimationFrame(tick);
}
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName) && state.layers.length) { e.preventDefault(); $("play").click(); }
});

// ------------------------------------------------------------------ final render
$("render").onclick = async () => {
  stopPlayback(); stopFinal();
  const chosen = state.layers.filter((l) => audible(l));
  if (!chosen.length) { $("progress").textContent = "Every layer is muted, so there's nothing to render."; return; }
  $("render").disabled = true;
  const t0 = performance.now();
  try {
    const stale = chosen.filter((l) => l.use === "pol" && status(l)[0] === "stale").map((l) => l.name);
    const editedRaw = chosen.filter((l) => l.use === "pol" && editedSincePolish(l)).map((l) => l.name);
    $("progress").textContent = "Rendering the song-level pass…";
    const layers = chosen.map((l) => ({ name: l.name, type: l.type, audio: (effectiveUse(l) === "pol" ? l.polished : l.raw).slice(),
      pan: l.settings.pan, width: l.settings.width, level_db: l.settings.level_db }));
    const r = await run("mix", { layers, raws: chosen.map((l) => l.raw.slice()) });
    const a = await ensureAnalysis();
    state.final = { ...r, chosen: chosen.map((l) => ({ ...l, use: effectiveUse(l) })), analysis: a };
    $("progress").textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s.` +
      (editedRaw.length ? ` Note: ${editedRaw.join(", ")} was edited after polishing, so its raw (edited) version was used. Re-polish to include polishing.` : "")
      + (stale.filter((n) => !editedRaw.includes(n)).length ? ` Note: ${stale.filter((n) => !editedRaw.includes(n)).join(", ")} changed since polishing, so the last polished version was used.` : "");
    showFinal();
  } catch (err) {
    $("progress").textContent = "Something went wrong: " + err.message;
  } finally { $("render").disabled = false; }
};

function showFinal() {
  const f = state.final;
  $("results").hidden = false;
  const stats = [["Tempo / key", `${f.analysis.tempo.toFixed(1)} BPM · ${f.analysis.key}`],
    ["In this mix", f.chosen.map((l) => `${l.name} (${l.use === "pol" ? "polished" : "raw"})`).join(", ")],
    ["Final loudness (streaming target −14)", `${f.finalLufs.toFixed(1)} LUFS`]];
  $("stats").innerHTML = stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v" style="font-size:15px">${esc(v)}</div></div>`).join("");
  const log = {
    statement: "All output is the user's own recordings, edited and processed in this browser. No audio was generated, replaced or uploaded.",
    song: { tempo_bpm: +f.analysis.tempo.toFixed(1), key: f.analysis.key, timing_master: state.layers[0].name, master_lufs: +f.finalLufs.toFixed(1) },
    layers: Object.fromEntries(f.chosen.map((l) => [l.name, { sound_type: l.type, version: l.use === "pol" ? "polished" : "raw",
      settings: l.settings, requests: l.history.map((h) => h.text), steps: l.use === "pol" ? l.report?.steps : ["none (raw)"],
      before: l.report?.before, after: l.use === "pol" ? l.report?.after : undefined }])),
    song_pass: f.actions,
  };
  $("log").textContent = JSON.stringify(log, (k, v) => (k === "bands_db" ? undefined : v), 2);
  const dl = $("downloads");
  dl.innerHTML = "";
  const link = (label, make, file) => { const b = document.createElement("button"); b.className = "small"; b.textContent = label; b.onclick = () => download(make(), file); dl.appendChild(b); };
  link("⬇ Final mix (WAV)", () => encodeWav(f.stereo), "song_mix.wav");
  link("⬇ Processing log", () => JSON.stringify(log, null, 2), "processing_log.json");
  drawWave(f.stereo[0]);
}
function download(data, file) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: file.endsWith(".json") ? "application/json" : "audio/wav" }));
  a.download = file; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function drawWave(y) {
  const c = $("wave"), g = c.getContext("2d"), w = c.width, h = c.height, step = Math.ceil(y.length / w);
  g.clearRect(0, 0, w, h);
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent");
  for (let x = 0; x < w; x++) {
    let m = 0;
    for (let i = x * step; i < Math.min(y.length, (x + 1) * step); i++) m = Math.max(m, Math.abs(y[i]));
    g.fillRect(x, h / 2 - (m * h) / 2, 1, Math.max(1, m * h));
  }
}

// final mix A/B player
let finalPlayer = null, finalMode = "pol";
function stopFinal() {
  if (!finalPlayer) return;
  finalPlayer.srcs.forEach((s) => { try { s.stop(); } catch {} });
  finalPlayer = null; $("play-final").textContent = "▶ Play final mix";
}
$("play-final").onclick = () => {
  if (finalPlayer) { stopFinal(); return; }
  stopPlayback();
  const ac = audioCtx(); ac.resume();
  const f = state.final, when = ac.currentTime + 0.05, gains = [], srcs = [];
  for (const chans of [[f.rawMix, f.rawMix], f.stereo]) {
    const b = ac.createBuffer(2, chans[0].length, SR); chans.forEach((c, i) => b.copyToChannel(c, i));
    const s = ac.createBufferSource(), g = ac.createGain(); s.buffer = b; s.connect(g).connect(ac.destination); s.start(when);
    srcs.push(s); gains.push(g);
  }
  gains[0].gain.value = finalMode === "raw" ? 1 : 0; gains[1].gain.value = finalMode === "pol" ? 1 : 0;
  srcs[1].onended = () => { if (finalPlayer && finalPlayer.srcs === srcs) stopFinal(); };
  finalPlayer = { srcs, gains };
  $("play-final").textContent = "■ Stop";
};
function setAB(mode) {
  finalMode = mode;
  $("ab-raw").classList.toggle("on", mode === "raw"); $("ab-pol").classList.toggle("on", mode === "pol");
  if (finalPlayer) {
    const t = audioCtx().currentTime;
    finalPlayer.gains[0].gain.setTargetAtTime(mode === "raw" ? 1 : 0, t, 0.02);
    finalPlayer.gains[1].gain.setTargetAtTime(mode === "pol" ? 1 : 0, t, 0.02);
  }
}
$("ab-raw").onclick = () => setAB("raw");
$("ab-pol").onclick = () => setAB("pol");

const timeline = createTimeline($("timeline"), {
  layers: () => state.layers,
  position: () => position(),
  seek: (sec) => seekTo(sec),
  songLength: () => songLength(),
  grid: () => state.analysis?.grid ?? null,
  onsetsFor: (l) => l.onsets,
  peaksFor,
  edit,
  undo, redo,
  canUndo: () => history.undo.length > 0,
  canRedo: () => history.redo.length > 0,
  statusFor: (l) => status(l)[1],
});

$("ver").textContent = INTERPRETER_VERSION;
renderAll();
window.layerpolish = { state, timeline, history };   // handy for debugging in the browser console
