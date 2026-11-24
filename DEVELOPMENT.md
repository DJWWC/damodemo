# DamoDemo: development notes

> ## ▶ START HERE (next session)
>
> **Status at 24 Nov 2026 (commit after `829122d`):** browser app live at
> https://djwwc.github.io/damodemo/ (GitHub Pages from `main` / `/docs`).
> Built: per-layer polish, plain-English interpreter v2, Arrange timeline
> (split / cut / copy / paste / duplicate / move, undo, snapping, iPad
> gestures), live mixer, final render, WAV / AIFF / MP3 / ZIP downloads,
> note and chord detection with MIDI export, Audio Adjustments panel,
> How to use side panel. Waiting on real-iPad testing (`TESTING.md`).
>
> **Next task: built-in recorder.** Spec below under
> "Next: built-in recorder". Then: Auto-polish, the Claude API upgrade,
> and browser vocal tuning.
>
> **To resume in a new Claude session:** "Connect the DJWWC/damodemo repo
> and build the recorder described in DEVELOPMENT.md (START HERE)."

Working notes on where the project is going. User-facing instructions are in
`README.md`.

## Ground rule for every AI feature

**The AI decides; ordinary signal processing does the work.**

An AI component may only output *decisions*: parameter values, edit
positions, timing offsets, pitch corrections in cents, gain changes, labels and
timestamps. The existing engine applies those decisions to the user's original
recording. No AI component may generate, re-synthesise or replace audio.

| Allowed (edits the original) | Not allowed (recreates it) |
|---|---|
| Choosing EQ, compression, reverb and level settings | Voice conversion / voice cloning |
| Deciding where to cut and how far to move a strum | Neural "re-singing" or re-synthesis of a performance |
| Deciding how many cents to re-pitch a sung note | AI stem regeneration or "enhance by regenerating" |
| Detecting problems (clipping, plosives, out-of-tune notes) | Generating new parts, fills or harmonies |
| Neural noise reduction that only attenuates parts of the original spectrum | Any model whose output is new audio |

A second rule: **audio never leaves the user's device.** Cloud AI calls may
only receive text and numbers (the request, the current settings and measured
descriptors), never audio.

## Current state (Nov 2026)

- Browser version (`docs/`, GitHub Pages) and Python version (repo root).
- Plain-English adjustments in the browser use the **offline interpreter v2**
  (`docs/interpret.js`). It handles qualities and problems, modifiers (less, too,
  slightly, a lot), character words, removal, level and width, layer lists, and
  messages for unsupported requests. It's free and works offline. The full
  phrase list, with version history, is in **`PROMPT_DICTIONARY.md`**, which is
  generated from the code.
- Audio adjustments: 17 per layer (grouped in the UI as Clean-up / EQ / Dynamics / Effects / Mix), including `nasal_db`, `width` and `level_db` (added with
  interpreter v2, in both versions).
- The Python version's offline rules (`assistant.py` `ask_offline`) are still
  v1 keyword rules. Its Claude path (`ask_claude`) can use all 17 adjustments if
  `ANTHROPIC_API_KEY` is set.

### Updating the interpreter

1. Edit `VOCAB` / `ABSOLUTE` / `UNSUPPORTED` in `docs/interpret.js`. Add a
   `show:` string if the regex won't read well when generated.
2. Bump `INTERPRETER_VERSION` and add a line to `HISTORY`.
3. Add test phrases to `tests/interpret_test.mjs` and run
   `node tests/interpret_test.mjs`.
4. Regenerate the dictionary: `node tools/build_dictionary.mjs > PROMPT_DICTIONARY.md`.

### Editing (Arrange) — built Nov 2026

- Non-destructive clip model (`docs/clips.js`). A layer is a list of clips
  pointing into original recordings; edits change the list only. Clips on a
  lane never overlap (moving or pasting replaces what's underneath). 5 ms
  fades at cut edges.
- Undo/redo stores snapshots of every layer's clip list (cheap), up to 100.
- Snapping: beat grid (bar / beat / half-beat) and/or other tracks' detected
  hits. Moving a clip snaps its start or its first hit, whichever is nearer.
- Any layer can be the timing master (*make timing master* moves it first).
  Tempo detection needs a rhythmic part: on the demo the vocal as master gave
  112 BPM instead of 90. Possible improvement: suggest or auto-pick the most
  rhythmic layer, or let the user type the tempo.
- The beat grid comes from the timing master's **original** recording, so it
  stays fixed while you edit.
- Edit then polish: polishing works on the edited audio. Editing a polished
  layer marks it *Edited: re-polish*, and the mixer and render use the edited
  raw version until it's re-polished.
- Built for iPad first: pointer events, pinch zoom, two-finger scroll,
  44 px touch targets on `pointer: coarse` screens, and no page zoom on
  timeline gestures. Audio at the device rate (48 kHz on iPad) is converted
  to 44.1 kHz on load.
- Tested with Chrome's iPad Pro 11 emulation (landscape and portrait) using
  real multi-touch events. **Not yet tested on a real iPad / Safari.**
- Not included (yet): speed/time-stretch (dropped for now), moving clips
  between lanes, ripple editing (closing gaps), per-clip fades or gain,
  recording directly in the app.

### Notes and chords — built Nov 2026

- Spotify Basic Pitch (Apache-2.0) via TensorFlow.js, bundled unmodified
  in `docs/vendor/basic-pitch/` (esbuild bundle of @spotify/basic-pitch
  1.0.1 + tfjs 3.21). Lazy-loaded on first use.
- Audio is down-sampled to 22.05 kHz (windowed-sinc FIR) as the model expects.
- Vocals and bass are reduced to one note at a time, and repeated same-pitch
  notes (vibrato splits) are joined.
- Chords per half-bar from note weights (duration × loudness). Notes still
  ringing from before count less, and 7th / sus / extension chords need that
  note actually played in the segment. Demo: exact C G Am F, melody 16/16
  notes correct.
- MIDI: type 1, one track per layer, detected tempo, absolute times (lines
  up with audio stems from 0:00), General MIDI programs per sound type.
- Speed: in headless Chrome with software WebGL, about 35 s per 23 s layer.
  Needs measuring on a real iPad GPU (TESTING.md 4.10).
- Next uses: browser vocal tuning (target notes known), snapping to note
  starts, a printable chord / lyric sheet.

### Roadmap stages

1. **Done:** smarter offline interpreter (v2).
2. **Next:** guided prompting. Suggestions from the analysis ("vocal looks
   harsh, try 'smoother'"), a preview of what a request will change, undo and
   per-request A/B. Still free and offline.
3. **Then:** Claude as the fallback for anything the interpreter doesn't
   understand (Level 1 below). This needs an API key. Costs are below.

## Next: built-in recorder (not built yet, next task)

Record straight into a new layer in the browser (iPad Safari first).

**Features (core, about 1–1.5 developer days):**
- **⏺ Record new layer** button: choose a sound type, record, and it becomes a
  normal layer (source, clips, lane, card) like an uploaded file.
- **Click track and count-in:** a tempo field (defaults to the detected song
  tempo once a layer exists, else 90), one-bar count-in, click on/off. The
  click must not be recorded, so it plays only to the output.
- **Overdub:** existing layers play (from the mixer, with mute/solo) while
  recording. Show "use headphones" when overdubbing.
- **Input level meter** with clipping and too-quiet warnings.
- **Music-quality capture:** `getUserMedia({audio: {echoCancellation: false,
  noiseSuppression: false, autoGainControl: false}})`. Device picker for USB
  interfaces (`enumerateDevices`).
- **Latency compensation:** shift new takes by `outputLatency + baseLatency`
  (where available) plus a one-time calibration (record a click back through
  the mic, measure the offset, and save it with try/catch localStorage).
- Capture with an AudioWorklet (fallback: ScriptProcessor) into Float32 chunks.
  The context runs at the device rate (48 kHz on iPad), so resample to 44.1 kHz
  as `decode()` already does (OfflineAudioContext).
- Stop if the page is hidden. Keep the screen awake if supported.

**Later:** multiple takes per layer with take picking, punch-in, and a
calibration wizard.

**Testing:** Chrome with `--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream` gives a test tone as the mic, which tests
the pipeline, alignment and UI. Real mic quality, iPad latency and USB
interfaces must be tested on a real iPad: add rows to `TESTING.md`.

### How the code is organised (browser, `docs/`)

| File | Role |
|---|---|
| `app.js` | Page logic: layers (`addLayer`, `reflatten`, `edit` / undo), worker jobs, polish, mixer playback (`startPlayback`, `applyLiveMix`), final render, exports, notes |
| `engine.js` | All DSP (pure JS): analysis, repair, tone chain, song pass, LUFS |
| `worker.js` | Background jobs: `analyse`, `polish`, `onsets`, `mix` |
| `clips.js` | Non-destructive clip editing |
| `timeline.js` | Arrange timeline UI and touch gestures |
| `interpret.js` / `settings.js` | Plain-English interpreter, sound types, presets, Audio Adjustments groups |
| `export.js` / `mp3worker.js` | WAV / AIFF / MP3 / ZIP |
| `notes.js` | Basic Pitch note detection, chords, MIDI |

New layers must go through `addLayer(name, type, float32At44k)`, so a recorded
take gets clips, peaks, onsets and analysis automatically.

### How it has been tested

- Node: `node tests/clips_test.mjs`, `node tests/interpret_test.mjs`,
  `node tests/engine_test.mjs /tmp/out`, `node tests/export_test.mjs /tmp/exp`,
  `tests/notes_test.mjs` (needs `@spotify/basic-pitch` installed and `docs/`
  served on :8765; see file).
- Headless Chrome via Python Playwright (`/usr/bin/google-chrome`), serving
  `docs/` with `python3 -m http.server 8765 -d docs`. iPad emulation with
  `p.devices["iPad Pro 11 landscape"]` and real multi-touch through CDP
  `Input.dispatchTouchEvent`. `window.damodemo` exposes `{state, timeline,
  history}` for checks. Downloads checked with ffprobe and libsndfile.

## Planned: Auto-polish (automatic "beauty filter")

Not built yet. Proposed after real-world testing (see `TESTING.md`).

**What it does:** an **Auto-polish** button per layer (and for all layers)
that measures the layer, compares it with target ranges for its sound type,
and moves the existing audio adjustments to close the gap. A **strength slider (0–100%)**
works like a photo filter's intensity. The changes are listed and shown in the
Audio Adjustments panel, so the user can override any of them by hand or with a request.

**How it works (rule-based v1, free, on-device):**
1. Targets per sound type: tonal balance (low / low-mid / mid / presence /
   air), mud (250–600 Hz), harshness and sibilance (5–9 kHz), nasal (~1 kHz),
   dynamics (how much compression), noise floor, timing spread, and level
   relative to the other layers.
2. Measure the layer (most of this already exists in the before/after reports).
3. Map each gap to a capped adjustment, e.g. low-mids +3 dB over target →
   boxiness −3 dB; too dynamic → more compression; hiss → more noise clean-up.
4. Process, re-measure, adjust: 2–3 rounds until within target.
5. Song level: reduce clashes between layers and balance levels (the final
   mix pass already does a basic version).

**How it knows what's "better":** it only knows the distance from its
targets, so the targets carry the judgement:
- v1: engineering rules of thumb for known problems (mud, harshness, hiss,
  uneven level). This is "less wrong" more than "more beautiful".
- v2: targets measured from well-produced reference recordings, per style or
  preset, since genres measure differently.
- User reference: "make it sound like this track", measured on the device and
  used as the target.
- Optional later: Claude chooses targets from taste words plus measurements
  (API cost, see below).

**Checking it with ears, not numbers:**
- Blind A/B listening: play raw and auto-polished in random order and see
  which testers pick. (Possible feature: a blind A/B mode in the page.)
- Watch what users undo or reverse after Auto (tracked locally only). A move
  that keeps getting reversed means that target is wrong.

**Limits:** good at removing problems, less good at creating a style (presets
and requests still handle style). It can make everything sound alike if pushed
hard, hence the strength slider and visible changes. It only improves what was
recorded.

**Effort:** rule-based v1 with the Auto button, strength slider and
measure-and-adjust loop is about 1–1.5 developer days, reusing the existing
measurements and adjustments.

## AI roadmap

### Level 1: AI engineer that sets the audio adjustments (easy, ~1 day)

**What it does:** the user types anything ("the vocal sounds nasal and far
away", "make the chorus guitar sit back a bit") and Claude chooses new values
for the existing parameters, with a one-line explanation. It replaces the
keyword rules when a key is present and falls back to them when it isn't.

**How:**
- Port `assistant.py` `ask_claude` to `docs/assistant.js`. Same `adjust`
  tool: `{layer, param, value}`, enum-restricted to `PARAMS`, values clamped.
- Send: the request, current settings, and per-layer descriptors (LUFS,
  band balance, quietest level, timing report, chords). No audio.
- Browser calls go straight to `https://api.anthropic.com/v1/messages` with
  the `anthropic-dangerous-direct-browser-access: true` header (Anthropic's
  opt-in for calling the API from a web page).
- UI: an optional "Claude API key" field, kept in memory or session storage
  only, with a note on where it's stored. The changes list shows what Claude
  changed and why.

**Inputs:** ~2,000 tokens per request (instructions + tool schema + settings +
measurements). **Outputs:** ~200 tokens. These counts are independent of song
length.

### Level 2: auto-polish loop (medium, a few days)

**What it does:** one "Auto-polish" button. Claude proposes settings, the
engine processes and re-measures, and Claude sees the new measurements and
refines them. It stops after N rounds or when targets are met. Optional target:
"match this reference track", where the reference is analysed locally and only
its measurements are sent.

**How:** a loop around Level 1 with a `finish` tool, a round limit (e.g. 5),
and measurements of the processed result fed back each round. Needs a fast
"measure only" path in the engine, and possibly a shorter preview segment for
speed.

**Inputs:** grows each round (~2k → ~10k tokens over 5 rounds). **Outputs:**
~200–400 tokens per round.

### Level 3: AI "ears" (medium)

**What it does:** machine-learning models running locally in the browser that
*listen* and report, but change nothing:
- clipping, pops, clicks, plosives, breaths, with timestamps
- out-of-tune notes with cents offset (neural pitch tracking, e.g. CREPE-style)
- loose strums or late entries
- instrument identification, to suggest the sound type automatically

The engine (or Level 1/2) acts on the report: targeted de-click at those
timestamps, per-note tuning, and so on.

**How:** ONNX models run via `onnxruntime-web` (WASM/WebGPU) inside the
worker. No API cost. The model download (a few MB to tens of MB) is cached by
the browser. Check each model's licence before shipping.

### Level 4: neural clean-up by attenuation only (medium, vocals only)

**What it does:** better noise and room-sound reduction on vocals than the
current spectral gate.

**Candidates:**
- **RNNoise**: small, available as WASM for web frontends.
- **DeepFilterNet 3**: higher quality, ONNX exports exist, dual-licensed
  MIT or Apache-2.0 (commercial redistribution allowed with the notice kept).

**Why it's allowed:** these models compute a gain/filter mask applied to the
original spectrum. They turn parts of the sound down and don't generate new
audio.

**Caveat:** both are trained mainly on speech. Use them on vocal layers only.
On guitar or keys they can strip tone and transients. Run at 48 kHz (resample
in and out) and offer a strength control.

### Also on the list (not AI)

- Vocal tuning in the browser: per-note pitch shift. Needs a pitch-shifting
  library compiled to WASM (SoundTouch or Rubber Band. Rubber Band is GPL, so
  check the licence).
- More sound types: keys, drums (drums need a different timing approach).

## API costs

### Prices used (Anthropic API, per million tokens, checked 24 Nov 2026)

| Model | Input | Output |
|---|---|---|
| Claude Haiku 5.5 | $0.10 (prompts ≤100k tokens) | $0.50 (prompts ≤100k tokens) |
| Claude Sonnet 5.5 | $2 | $10 |
| Claude Opus 5.5 | $4 | $20 |

Source: platform.claude.com/docs/en/about-claude/pricing. Check again before
relying on these figures.

### Estimated cost per song (30 s, 2 layers; song length barely matters)

| Model | Per request (L1) | 10-request tweak session | Auto-polish, 5 rounds (L2) |
|---|---|---|---|
| **Haiku 5.5 (default)** | ~$0.0003 | ~$0.003 | ~$0.003 |
| Sonnet 5.5 | ~$0.006 | ~$0.06 | ~$0.10 |
| Opus 5.5 | ~$0.012 | ~$0.12 | ~$0.20 |

The token counts behind these are estimates. Measure real usage from the API's
`usage` field once Level 1 is built and update this table.

Levels 3 and 4 run locally and have **no per-use cost**, only development
time and model download size.

### Who pays

- **A Claude Pro subscription does not include API access.** The API is billed
  separately through a Claude Console account (console.anthropic.com) with
  prepaid credit. Max, Ultra and Team plans include some monthly API credit;
  Pro doesn't.
- **Option A: bring your own key (recommended for testing).** Each user pastes
  their own API key into the page. It costs the project nothing. The key is
  visible in that user's own browser, which is acceptable for their own key.
- **Option B: hosted relay.** A small server (e.g. a Cloudflare Worker) holds
  the project's key and forwards requests. Users need nothing, but the project
  pays for all usage, so it needs rate limits and a monthly spend cap.
- Whichever key is used, set a **monthly spend limit** in the Console.

## Open decisions

- [ ] Option A (own key) or Option B (hosted relay) for Level 1
- [ ] Default model: Haiku 5.5 (cheapest), with Sonnet as an option if Haiku
      misreads vague requests
- [ ] Whether Level 2 should support "match a reference track"
- [ ] Which Level 3 detections matter most to real users. Ask testers after
      they've tried real recordings
