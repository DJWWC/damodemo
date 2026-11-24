# DamoDemo (prototype)

An automatic producer/engineer for raw home recordings. You record each part
(guitar, vocal, bass...) as its own track. DamoDemo:

1. **Recognises** each take: tempo, key, chords (instruments), sung notes and how
   far off they are (vocals), timing accuracy, noise and tone.
2. **Beautifies each layer** with a chain built for that sound type: noise
   clean-up, timing pulled towards the beat, vocal tuning pulled into key, EQ,
   compression, saturation and reverb.
3. Lets you **adjust it in plain English** ("vocal: warmer and less harsh",
   "guitar: tighter").
4. Runs a **song-level pass**: makes room for the vocal, balances the layers
   and brings the mix to streaming loudness (-14 LUFS).

## How to use (quick start)

Open **https://djwwc.github.io/damodemo/** on an iPad or computer. The same
guide is in the **How to use** tab on the right edge of the page.

1. **Record your takes:** one instrument or vocal per recording, same tempo
   (a click helps), all starting from the same moment, with about a second
   of silence at the start. Tune guitars first. On iPad, record in Voice
   Memos or GarageBand and save the files to the Files app.
2. **Add your layers** (section 1), or *Load demo takes* to try it. Check each
   layer's type. The first layer is the timing master, so use your best-timed
   part.
3. **Listen** with the play bar at the top, and the mixer's Mute / Solo.
4. **Arrange, if needed** (section 2): split, cut, copy, paste, duplicate,
   move, with snapping and undo. Arrange before polishing.
5. **Polish each layer** (section 1): type requests in the layer's box
   ("warmer", "less nasal", "tighter"), tap *Polish this layer*, listen, and
   adjust and *Re-polish* as needed.
6. **Balance the mix** (section 4): Raw / Polished per layer, volume, pan.
7. **Render the final mix** (section 5), compare it with the unprocessed mix,
   and download the WAV.

Nothing is saved between visits yet, so download your mix before closing the
page.

**Testing:** a step-by-step real-world test plan for iPad is in
[TESTING.md](TESTING.md).

## Try it in your browser

**https://djwwc.github.io/damodemo/**

Nothing to install, and it's built for **iPad** (Safari) as well as computers.
Work one layer at a time:

1. **Layers:** add each take (or load the demo). Each layer card has its own
   **Polish this layer** button, its own request box ("warmer, less nasal"),
   its settings, and a before/after report. Its status shows *Not polished*,
   *Polished*, *Changed: re-polish* or *Edited: re-polish*.
2. **Arrange:** a timeline with one lane per layer. **Split, cut, copy,
   paste, duplicate, delete and move** parts, with **undo/redo**. Parts
   **snap** to the beat grid (bar / beat / half-beat), to other tracks' hits
   (line a vocal entry up with a guitar strum), or both. When you move a part,
   either its start or its first hit snaps, whichever is closer. Edits are
   non-destructive, so your original recordings are never changed.
   - Touch: **Move** tool: tap a part to select it (and place the playhead),
     drag to move it. **Select** tool: drag across a lane to select a range.
     Tap empty space or the ruler to move the playhead. **Pinch** to zoom,
     **two fingers** to scroll, or use − / + / Fit and the scroll slider.
   - Keyboard (computer): S split, Ctrl/Cmd+X / C / V / D, Delete,
     Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z.
   - Edit first, then polish: editing a polished layer marks it *Edited:
     re-polish*, and the mixer plays the edited raw version until you do.
3. **Overall style:** a preset and a request box for the whole song.
4. **Mixer:** plays every layer together in sync, using the play bar that
   stays at the top of the page, with a timeline slider to scrub. Each layer
   has **Mute**, **Solo**, a **Raw / Polished** switch (works mid-playback),
   and **volume** and **pan** sliders. Space bar plays and stops.
5. **Final mix:** renders exactly what the mixer is set to (muted layers left
   out, raw or polished as chosen) through the song-level pass. You can compare
   it with the unprocessed mix and download it.

### Notes and chords

Tap **🎵 Detect notes** on a layer (or **Detect notes on all** in the mixer).
It uses Spotify's open-source Basic Pitch model, running on the device:

- **Guitars and bass:** a chord chart by bar (e.g. `1 C · 2 G · 3 Am · 4 F`).
- **Vocals and bass:** the melody as note names.
- **Timeline:** notes drawn on each lane as a mini piano roll, with chord
  names above. Toggle with **🎵 Notes**.
- **MIDI:** **⬇ MIDI** per layer, or **⬇ MIDI (all layers)**: one track per
  layer at the detected tempo, lined up from 0:00, ready for GarageBand,
  Logic or any DAW. MIDI is also included in the ZIP downloads.

It reads what was played and doesn't generate audio. The model (about 1.2 MB)
downloads the first time it's used. On the demo takes it finds the exact
chords and every melody note. Expect some mistakes on real recordings,
especially busy strumming. Editing a layer marks its notes as needing
re-detection.

### Downloads (any stage, for other software)

Pick the format once from **⬇** in the play bar: **WAV** 24-bit (studio),
16-bit (CD) or 32-bit float, **AIFF** 24-bit, or **MP3** 320 / 192 / 128 kbps.
All files are 44.1 kHz.

| Where | Download |
|---|---|
| Each layer card | **⬇ Arranged** (edited, unpolished) and **⬇ Polished** |
| Mixer | **⬇ All layers (ZIP)**: every layer, as chosen in the mixer |
| Final mix | **⬇ Final mix** (stereo), **⬇ Final mix + all layers (ZIP)**, processing log |

Every layer file is mono, **starts at 0:00 and runs the full song length**, so
the files line up when dropped into Logic, Pro Tools, Ableton, Cubase or
GarageBand. Layer files are dry: mixer volume and pan only apply to the final
mix. Each ZIP includes a README with the tempo and key.

The browser version does all the processing on your own device in
JavaScript (`docs/`). Your audio is never uploaded. It has everything in the
Python version except vocal tuning.

Every phrase the adjustment box understands, and what each one changes, is
listed in **[PROMPT_DICTIONARY.md](PROMPT_DICTIONARY.md)**. Plans and costs for
AI features are in [DEVELOPMENT.md](DEVELOPMENT.md).

## The ownership principle

Everything that comes out is **your recording, edited and processed**: slices
moved in time, notes re-pitched, EQ, compression and so on. Nothing is generated
or replaced, and no audio is uploaded anywhere. The AI assistant never receives
audio. It gets measurements (loudness, tonal balance, timing and pitch accuracy)
and can only turn the existing, range-limited knobs. Each run writes a
`processing_log.json` that records exactly what was done to each layer.

## Install

Python 3.10 or newer.

```bash
pip install -r requirements.txt
```

## Try it with the built-in demo takes

```bash
python make_demo.py          # writes demo_takes/guitar.wav and demo_takes/vocal.wav (deliberately sloppy synth takes)
python polish.py \
  --layer demo_takes/guitar.wav:acoustic_guitar:guitar \
  --layer demo_takes/vocal.wav:vocal \
  --key "C major" \
  --preset intimate_acoustic \
  --prompt "vocal: warmer and less harsh" \
  --prompt "guitar: tighter" \
  --out output
```

Compare `output/raw_mix.wav` with `output/song_mix.wav`. The demo takes are
crude synth stand-ins: they show what the processing does, not how a real
guitar or voice will sound. Use real recordings to judge quality.

## Use your own recordings

`--layer path:sound_type[:name]`, repeated once per track.

**Recording tips (they make a big difference):**
- One instrument per take, with no singing while playing on the same mic.
- Record everything at the same tempo, ideally to a click. The **first
  `--layer` is the timing master**, so record and list your best-timed part first.
- Tune the guitar before recording. Tuning is corrected on vocals only.
- Start each take with about 1 second of silence. The noise clean-up learns your
  room's hiss from the quietest part.
- Line the files up so they all start at the same moment (export from the same
  start point in your recorder/DAW).
- WAV or FLAC, 44.1 or 48 kHz. Mono is fine.

**Sound types:** `vocal`, `acoustic_guitar`, `electric_guitar`, `bass`

**Presets:** `natural`, `intimate_acoustic`, `radio_pop`, `big_room`, `lofi_warm`

**Other options:**
- `--key "A minor"` overrides key detection (worth doing; detection can confuse
  relative keys)
- `--no-song-pass` outputs the polished layers only

### Prompt examples

Prefix with a layer name to target it, otherwise it applies to all layers.
Separate clauses with `;`.

```
"vocal: warmer; guitar: brighter"
"vocal: less tuned, more natural"
"guitar: looser, more human"
"more reverb"            (all layers)
"vocal: drier and more intimate"
"bass: punchier"
```

**Offline mode (default):** a keyword interpreter handles the prompts. It's
simple, but it works with no account and no internet.

**Claude mode:** set an Anthropic API key and the prompts are interpreted by
Claude through tool calls on the same knobs, with the measurements as context.
This handles much freer requests ("the vocal sounds a bit nasal and far away").

```bash
export ANTHROPIC_API_KEY=sk-ant-...           # Windows PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
export DAMODEMO_MODEL=claude-haiku-5-5     # optional; default shown
```

Only the prompt text, the settings and the numeric measurements are sent. Audio
never is.

## Output files

| File | What it is |
|---|---|
| `song_mix.wav` | Final stereo mix after the song-level pass |
| `raw_mix.wav` | Your raw layers summed, for before/after comparison |
| `<layer>_polished.wav` | Each layer after its own beautify chain (take these into a DAW if you like) |
| `<layer>_recognised.json` | What the app recognised: chords, melody notes, timing/pitch accuracy, tone |
| `processing_log.json` | Every setting, prompt and change, with before/after measurements |

## Code map

| File | Role |
|---|---|
| `analysis.py` | Recognition and measurement (tempo grid, key, chords, pitch tracking, loudness, tonal balance) |
| `repair.py` | Noise reduction, timing tightening, vocal tuning, gap gate |
| `chain.py` | Sound types, presets, the parameter list (the AI's "knobs") and the effects chain |
| `assistant.py` | Plain-English prompts to knob changes (Claude tool use, or offline rules) |
| `song.py` | Song-level pass: unmasking, low-end, balance, bus compression, loudness and limiting |
| `polish.py` | Command-line entry point |
| `make_demo.py` | Generates sloppy test takes |
| `docs/` | Browser version, served by GitHub Pages: `engine.js` (all DSP), `settings.js` (sound types, presets, knobs), `app.js` (page), `worker.js` (background processing), `demo.js` (demo takes) |
| `docs/interpret.js` | Plain-English interpreter (v2): vocabulary, modifiers, layer targeting |
| `docs/clips.js` | Non-destructive editing: clips, split / cut / copy / paste / duplicate / move, flatten with anti-click fades, snap search |
| `docs/timeline.js` | Arrange timeline: lanes, waveforms, grid, touch gestures (pinch, two-finger scroll), tools, snapping |
| `tests/clips_test.mjs` | Editing tests: `node tests/clips_test.mjs` |
| `docs/export.js`, `docs/mp3worker.js` | Downloads: WAV / AIFF writers, MP3 (lamejs, in a background worker), ZIP |
| `tests/export_test.mjs` | Writes test WAV / AIFF / ZIP files: `node tests/export_test.mjs /tmp/exp` |
| `docs/notes.js` | Note detection (Basic Pitch), chord naming, chord chart by bar, MIDI writer |
| `tests/notes_test.mjs` | Runs note detection on the demo takes. Needs `@spotify/basic-pitch` installed and `docs/` served on :8765 (see file) |
| `tests/engine_test.mjs` | Runs the browser engine end to end in Node: `node tests/engine_test.mjs /tmp/out` |
| `tests/interpret_test.mjs` | Phrase tests for the interpreter: `node tests/interpret_test.mjs` |
| `tools/build_dictionary.mjs` | Regenerates `PROMPT_DICTIONARY.md` from `docs/interpret.js` |

## Known limitations (it's a prototype)

- Offline processing only, with no real-time playback or interface. One run takes
  about 30 seconds for a 25-second song.
- Timing correction cuts at each attack, moves it, and stretches the decay
  into any gap. Large corrections on sustained playing can still produce
  audible joins. Lower `timing_strength` ("looser") if so.
- Vocal tuning is a basic pitch shift (no formant preservation). Big
  corrections sound processed. It won't match Melodyne or Auto-Tune.
- Chord recognition is template matching and confuses closely related chords
  (e.g. C and Em).
- No tuning correction for chords (strummed guitar). Tune before recording.
- Drums and keys aren't supported yet.

## Licences

MP3 export uses [LAME](https://lame.sourceforge.io) through lamejs
(LGPL-3.0, unmodified, in `docs/vendor/`, licence note alongside).
Note detection uses Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch-ts)
model and TensorFlow.js (both Apache-2.0), bundled unmodified in
`docs/vendor/basic-pitch/` (see `NOTICE.txt` there).

The prototype depends on open-source libraries, including Spotify's
`pedalboard` (GPL-3.0), `librosa` (ISC), `noisereduce` (MIT) and `pyloudnorm`
(MIT). Using GPL components is fine for personal use and testing. Selling a
closed-source product built on them needs those parts replaced or licensed
differently.
