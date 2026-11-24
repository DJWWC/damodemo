import { PARAMS, SOUND_TYPES, PRESETS, defaultSettings } from "./settings.js";
import { interpret, INTERPRETER_VERSION } from "./interpret.js";
import { SR, encodeWav } from "./engine.js";
import { demoGuitar, demoVocal } from "./demo.js";

const $ = (id) => document.getElementById(id);
const state = { layers: [], settings: {}, baseline: {}, result: null };
let ctx = null;
const audioCtx = () => (ctx ??= new AudioContext({ sampleRate: SR }));

// ------------------------------------------------------------------ layers
function guessType(name) {
  const n = name.toLowerCase();
  if (/vocal|vox|voice|sing|lead/.test(n)) return "vocal";
  if (/bass/.test(n)) return "bass";
  if (/elec|dist|amp/.test(n)) return "electric_guitar";
  return "acoustic_guitar";
}

function uniqueName(base) {
  base = base.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "layer";
  let n = base, i = 2;
  while (state.layers.some((l) => l.name === n)) n = `${base}${i++}`;
  return n;
}

function addLayer(name, type, raw) {
  name = uniqueName(name);
  state.layers.push({ name, type, raw });
  state.settings[name] = defaultSettings(type, $("preset").value);
  state.baseline[name] = { ...state.settings[name] };
  renderLayers();
}

async function decode(file) {
  const buf = await audioCtx().decodeAudioData(await file.arrayBuffer());
  const n = buf.length, mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  return mono;
}

function renderLayers() {
  const box = $("layers");
  box.innerHTML = "";
  if (!state.layers.length) {
    box.innerHTML = '<div class="empty">No layers yet. Add your takes, or load the demo to try it.</div>';
  }
  state.layers.forEach((l, idx) => {
    const el = document.createElement("div");
    el.className = "layer";
    const typeOpts = Object.entries(SOUND_TYPES).map(([k, v]) => `<option value="${k}" ${k === l.type ? "selected" : ""}>${v.label}</option>`).join("");
    el.innerHTML = `
      <div class="row">
        <input type="text" value="${l.name}" title="Name used in prompts">
        <select>${typeOpts}</select>
        <span class="meta">${(l.raw.length / SR).toFixed(1)} s</span>
        ${idx === 0 ? '<span class="master">timing master</span>' : '<button class="small" data-act="up" title="Make this the timing master">↑ first</button>'}
        <button class="small" data-act="play">▶ raw</button>
        <button class="small" data-act="del">Remove</button>
      </div>
      <details><summary>Knobs (what presets and prompts change)</summary><div class="knobs"></div></details>`;
    const [nameIn] = el.getElementsByTagName("input");
    nameIn.onchange = () => {
      const old = l.name;
      l.name = "";
      l.name = uniqueName(nameIn.value);
      state.settings[l.name] = state.settings[old]; state.baseline[l.name] = state.baseline[old];
      if (old !== l.name) { delete state.settings[old]; delete state.baseline[old]; }
      renderLayers();
    };
    el.querySelector("select").onchange = (e) => {
      l.type = e.target.value;
      state.settings[l.name] = defaultSettings(l.type, $("preset").value);
      state.baseline[l.name] = { ...state.settings[l.name] };
      renderLayers();
    };
    el.querySelectorAll("button[data-act]").forEach((b) => (b.onclick = () => {
      if (b.dataset.act === "del") { state.layers.splice(idx, 1); delete state.settings[l.name]; renderLayers(); }
      if (b.dataset.act === "up") { state.layers.splice(idx, 1); state.layers.unshift(l); renderLayers(); }
      if (b.dataset.act === "play") playBuffers([[l.raw]], b);
    }));
    const knobs = el.querySelector(".knobs");
    for (const [p, [lo, hi, desc]] of Object.entries(PARAMS)) {
      if (p === "timing_strength" && l.type === "vocal") continue;
      const v = state.settings[l.name][p], changed = Math.abs(v - state.baseline[l.name][p]) > 1e-6;
      const k = document.createElement("label");
      k.className = "knob" + (changed ? " changed" : "");
      k.title = desc;
      const step = hi - lo > 20 ? 1 : (hi - lo) / 100;
      k.innerHTML = `<span>${p.replace(/_/g, " ")}</span><input type="range" min="${lo}" max="${hi}" step="${step}" value="${v}"><span>${fmt(v)}</span>`;
      const input = k.querySelector("input");
      input.oninput = () => { state.settings[l.name][p] = +input.value; k.lastChild.textContent = fmt(+input.value); k.classList.add("changed"); };
      knobs.appendChild(k);
    }
    box.appendChild(el);
  });
  $("go").disabled = !state.layers.length;
}
const fmt = (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2));

// ------------------------------------------------------------------ presets & prompts
$("preset").innerHTML = Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
$("preset").onchange = () => {
  for (const l of state.layers) { state.settings[l.name] = defaultSettings(l.type, $("preset").value); state.baseline[l.name] = { ...state.settings[l.name] }; }
  $("changes").innerHTML = "";
  renderLayers();
};

const EXAMPLES = ["vocal: warmer and less harsh", "the vocal sounds a bit nasal", "guitar is too bright", "I can't hear the vocal", "guitar: tighter and wider", "make it more vintage", "vocal: no reverb", "dreamy guitar"];
$("chips").innerHTML = EXAMPLES.map((e) => `<span class="chip">${e}</span>`).join("");
$("chips").onclick = (e) => { if (e.target.classList.contains("chip")) { $("prompt").value = e.target.textContent; applyNow(); } };

function applyNow() {
  const text = $("prompt").value.trim();
  if (!text) return;
  if (!state.layers.length) { $("changes").innerHTML = "<li>Add a layer first.</li>"; return; }
  const layersByName = Object.fromEntries(state.layers.map((l) => [l.name, l]));
  const { changes, notes } = interpret(text, layersByName, state.settings, state.baseline);
  const li = document.createElement("li");
  const safe = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  li.innerHTML = `<b>“${safe(text)}”</b>`
    + (changes.length ? "<ul>" + changes.map((c) => `<li><code>${safe(c.text)}</code></li>`).join("") + "</ul>" : "")
    + notes.map((n) => `<div class="note">${safe(n)}</div>`).join("");
  $("changes").prepend(li);
  if (changes.length) $("prompt").value = "";
  renderLayers();
}
$("apply").onclick = applyNow;
$("prompt").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); applyNow(); } };

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
  $("progress").textContent = "Generating demo takes…";
  setTimeout(() => {
    addLayer("guitar", "acoustic_guitar", demoGuitar());
    addLayer("vocal", "vocal", demoVocal());
    $("progress").textContent = "Demo loaded: a sloppy strummed guitar and an off-pitch, hissy synth 'vocal'. Press ▶ raw to hear them.";
  }, 20);
};

// ------------------------------------------------------------------ processing
$("go").onclick = () => {
  stop();
  $("go").disabled = true;
  $("results").hidden = true;
  const t0 = performance.now();
  const worker = new Worker("worker.js", { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.progress) $("progress").textContent = m.progress;
    if (m.error) { $("progress").textContent = "Something went wrong: " + m.error.split("\n")[0]; $("go").disabled = false; worker.terminate(); }
    if (m.done) {
      worker.terminate();
      state.result = m;
      $("progress").textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
      $("go").disabled = false;
      showResults();
    }
  };
  worker.postMessage({
    layers: state.layers.map((l) => ({ name: l.name, type: l.type, raw: l.raw.slice() })),
    settings: JSON.parse(JSON.stringify(state.settings)),
  });
};

function showResults() {
  const r = state.result, log = r.log;
  $("results").hidden = false;
  const stats = [
    ["Tempo / key", `${log.song.tempo_bpm} BPM · ${log.song.key}`],
  ];
  for (const [name, l] of Object.entries(log.layers)) {
    if (l.before.timing) stats.push([`${name}: avg distance from beat`, `${l.before.timing.mean_ms} → ${l.after.timing.mean_ms} ms`]);
    const hb = l.before.describe.quietest_db, ha = l.after.describe.quietest_db;
    stats.push([`${name}: hiss/gap level`, `${hb} → ${ha < -90 ? "silent" : ha + " dB"}`]);
    if (l.before.chords?.length) stats.push([`${name}: chords heard`, l.before.chords.slice(0, 8).map((c) => c.chord).join(" ")]);
  }
  stats.push(["Final loudness (streaming target −14)", `${log.song.master_lufs} LUFS`]);
  $("stats").innerHTML = stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  $("log").textContent = JSON.stringify(log, (k, v) => (k === "bands_db" ? undefined : v), 2);
  const dl = $("downloads");
  dl.innerHTML = "";
  const link = (label, data, file, type = "audio/wav") => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = file;
    a.innerHTML = `<button class="small">${label}</button>`;
    dl.appendChild(a);
  };
  link("⬇ Polished mix (WAV)", encodeWav(r.mix), "song_mix.wav");
  for (const p of r.polished) link(`⬇ ${p.name}`, encodeWav([p.audio]), `${p.name}_polished.wav`);
  link("⬇ Processing log", JSON.stringify(log, null, 2), "processing_log.json", "application/json");
  drawWave(r.mix[0]);
}

function drawWave(y) {
  const c = $("wave"), g = c.getContext("2d"), w = c.width, h = c.height, step = Math.ceil(y.length / w);
  g.clearRect(0, 0, w, h);
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent");
  for (let x = 0; x < w; x++) {
    let m = 0;
    for (let i = x * step; i < Math.min(y.length, (x + 1) * step); i++) m = Math.max(m, Math.abs(y[i]));
    g.fillRect(x, h / 2 - m * h / 2, 1, Math.max(1, m * h));
  }
}

// ------------------------------------------------------------------ playback (A/B)
let player = null;
function stop() {
  if (!player) return;
  player.sources.forEach((s) => { try { s.stop(); } catch {} });
  if (player.button) player.button.textContent = player.label;
  player = null;
  $("play").textContent = "▶ Play";
}

function makeBuffer(chans) {
  const ac = audioCtx(), b = ac.createBuffer(chans.length, chans[0].length, SR);
  chans.forEach((c, i) => b.copyToChannel(c, i));
  return b;
}

/** groups: array of channel-arrays played in sync; returns gain nodes */
function playBuffers(groups, button) {
  const was = player && player.button === button;
  stop();
  if (was) return null;
  const ac = audioCtx();
  ac.resume();
  const t = ac.currentTime + 0.05, gains = [], sources = [];
  for (const chans of groups) {
    const s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = makeBuffer(chans);
    s.connect(g).connect(ac.destination);
    s.start(t);
    sources.push(s); gains.push(g);
  }
  sources[0].onended = () => { if (player && player.sources === sources) stop(); };
  player = { sources, gains, button, label: button ? button.textContent : "" };
  if (button) button.textContent = "■ stop";
  return gains;
}

let abMode = "pol";
function setAB(mode) {
  abMode = mode;
  $("ab-raw").classList.toggle("on", mode === "raw");
  $("ab-pol").classList.toggle("on", mode === "pol");
  if (player && player.gains.length === 2) {
    const ac = audioCtx(), t = ac.currentTime;
    player.gains[0].gain.setTargetAtTime(mode === "raw" ? 1 : 0, t, 0.02);
    player.gains[1].gain.setTargetAtTime(mode === "pol" ? 1 : 0, t, 0.02);
  }
}
$("ab-raw").onclick = () => setAB("raw");
$("ab-pol").onclick = () => setAB("pol");
$("play").onclick = () => {
  if (player && player.button === $("play")) return stop();
  const r = state.result;
  // raw mix is a quick level-matched sum so the comparison is fair
  const gains = playBuffers([[r.rawMix, r.rawMix], r.mix], $("play"));
  if (gains) { gains[0].gain.value = abMode === "raw" ? 1 : 0; gains[1].gain.value = abMode === "pol" ? 1 : 0; }
};

renderLayers();
$("ver").textContent = INTERPRETER_VERSION;
