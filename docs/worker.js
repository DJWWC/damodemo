// Runs the processing off the page's main thread so the page stays responsive.
import { runSession } from "./engine.js";

self.onmessage = async (e) => {
  const { layers, settings } = e.data;
  try {
    const res = await runSession(layers, settings, async (msg) => self.postMessage({ progress: msg }));
    const transfer = [res.mix[0].buffer, res.mix[1].buffer, res.rawMix.buffer, ...res.polished.map((p) => p.audio.buffer)];
    self.postMessage({ done: true, mix: res.mix, rawMix: res.rawMix,
      polished: res.polished.map((p) => ({ name: p.name, audio: p.audio })), log: res.log }, transfer);
  } catch (err) {
    self.postMessage({ error: String(err && err.stack || err) });
  }
};

