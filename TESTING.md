# DamoDemo: real-world test plan

Everything so far has been tested with synthetic demo takes in Chrome's iPad
emulation. This plan tests it with **real recordings on a real iPad**.

Allow about an hour. Note results in the tables (✅ works / ⚠️ works but odd /
❌ broken) and add a comment for anything that isn't ✅.

**Device:** iPad model ________ · iPadOS version ________ · Browser: Safari / other ________

Site: **https://djwwc.github.io/damodemo/**

---

## 1. Make the test recordings

Record on the iPad (Voice Memos or GarageBand) and save to the Files app.
Use a metronome or click at about **90 BPM**, and leave **1–2 seconds of
silence** at the start of each take.

| # | Recording | Why |
|---|---|---|
| R1 | **Guitar:** a simple chord progression, ~8 bars, played as well as you can | Normal case, and the timing master |
| R2 | **Vocal:** sing over R1 (headphones on, so the guitar doesn't bleed into the vocal mic) | Vocal processing, balance with guitar |
| R3 | **Sloppy guitar:** the same part, deliberately a bit early and late on some strums | Does timing correction help, and does it sound natural? |
| R4 | **Noisy vocal:** a short vocal with a fan, fridge or open window in the background | Noise clean-up |
| R5 | *(optional)* **Bass or second guitar** over R1 | Three-layer mix, the "make room for bass" step |

Tip: start every take at the same moment (e.g. count in from the click), so
the layers line up when loaded.

---

## 2. Loading and playback

| # | Test | Expected | Result | Comment |
|---|---|---|---|---|
| 2.1 | Open the site, tap the **How to use** tab, then close it | Panel slides in from the right and closes with × or a tap outside | | |
| 2.2 | **+ Add audio files** → pick R1 and R2 from Files | Two layer cards and two timeline lanes appear, with sensible names and types | | |
| 2.3 | Check each layer's type (Vocal / Acoustic guitar) and correct it if wrong | Type changes | | |
| 2.4 | Tap **▶ Play** in the top bar | Both layers play in sync. Timer moves | | |
| 2.5 | Is there sound? If not: volume up, not muted in Control Centre, tap Play again | Sound plays | | |
| 2.6 | Drag the top timeline slider while playing | Playback jumps without glitches | | |
| 2.7 | Mixer: **M** on the vocal, then **S** on the guitar, then clear both | Mute and solo work instantly | | |
| 2.8 | **▶ Play this layer** on the vocal card | Only the vocal plays | | |
| 2.9 | Do the layers line up in time? | Guitar and vocal sound together, not offset | | |
| 2.10 | Tap **make timing master** on the vocal, then back on the guitar | The "timing master" label moves and polished layers show *Changed: re-polish*. With the vocal as master the tempo may be wrong (expected), so switch back to the guitar | | |

---

## 3. Arrange (timeline editing)

| # | Test | Expected | Result | Comment |
|---|---|---|---|---|
| 3.1 | **Pinch** on the timeline to zoom in, then out | Zooms smoothly. The page itself doesn't zoom | | |
| 3.2 | **Two-finger drag** to scroll along the timeline | Scrolls | | |
| 3.3 | **Move** tool: tap the guitar near bar 3 → **Split** | Guitar splits into two parts at the playhead (on a beat line) | | |
| 3.4 | Drag the second part right by about a beat | It moves and snaps (dashed blue line while dragging) | | |
| 3.5 | **Undo**, then **Redo** | Part goes back, then moves again | | |
| 3.6 | **Select** tool: drag across 2 bars of the vocal → **Copy** → tap later in the vocal lane → **Paste** | The copied section appears where you tapped | | |
| 3.7 | Select a section → **Duplicate** | Copy appears straight after the selection | | |
| 3.8 | Select a section → **Delete** | That section goes silent | | |
| 3.9 | Snap: try **Off**, **Beat grid**, **Other tracks' hits** while dragging a part | Snapping changes accordingly. Is it too strong or too weak? | | |
| 3.10 | Play after editing | You hear the edits, with no clicks at the cuts | | |
| 3.11 | Is dragging precise enough with a finger? | Easy to place parts where you want | | |

Undo everything before section 4 (or reload the page and re-add the files).

---

## 4. Polishing each layer

| # | Test | Expected | Result | Comment |
|---|---|---|---|---|
| 4.1 | Guitar card: **Polish this layer** | Status: Polishing… → Polished ✓. A report appears (timing, hiss, chords) | | |
| 4.2 | How long did 4.1 take for your song length? | Time: ____ s for ____ s of audio | | |
| 4.3 | Mixer: flip the guitar **Raw / Polished** while playing | Polished sounds cleaner and tighter, and still like *your* guitar | | |
| 4.4 | Vocal card: type **"warmer and less harsh"** → Apply → **Re-polish** / Polish | Change list shows what was adjusted. Vocal sounds warmer | | |
| 4.5 | Try your own words for the vocal ("too nasal", "buried", "drier") | Sensible changes, or a clear "can't do that" message | | |
| 4.6 | Load R3 (sloppy guitar) with R1 as the timing master, and polish R3 | Timing noticeably tighter. Natural or robotic? | | |
| 4.7 | Load R4 (noisy vocal) and polish it | Background noise reduced without the voice sounding watery | | |
| 4.8 | Are the chords reported for R1 correct? | Chords match what you played | | |
| 4.9 | Edit a polished layer (split it) | Status: **Edited: re-polish**. Mixer uses the raw version until re-polished | | |

| 4.10 | **🎵 Detect notes** on the guitar (R1) | Finishes with a progress %. Time taken: ____ s for ____ s of audio | | |
| 4.11 | Is the chord chart right? | Chords by bar match what you played: ____________ | | |
| 4.12 | **🎵 Detect notes** on the vocal | Melody note names look right (roughly the notes you sang) | | |
| 4.13 | Timeline: notes and chord names show on the lanes. **🎵 Notes** toggles them | Chords line up with the bars | | |
| 4.14 | **⬇ MIDI** → open in GarageBand | The guitar/vocal notes play back as MIDI, in time with the audio | | |

---

## 5. Mix and final render

| # | Test | Expected | Result | Comment |
|---|---|---|---|---|
| 5.1 | Mixer: move volume and pan sliders while playing | Changes are heard immediately | | |
| 5.2 | **Render final mix** | Finishes. Shows tempo/key, layers used, −14 LUFS | | |
| 5.3 | Was the detected **tempo and key** right? | Tempo ____ (actual ____), key ____ (actual ____) | | |
| 5.4 | **▶ Play final mix**, switch **Unprocessed / Final** | Final sounds more balanced and finished, at similar loudness | | |
| 5.5 | Choose a format from **⬇** in the play bar, then **⬇ Final mix**. Try WAV 24-bit and MP3 | File saves to Files / Downloads and plays in another app | | |
| 5.5b | **⬇ Final mix + all layers (ZIP)** → open it in Files (tap to unzip) | Final mix, one file per layer, log and README | | |
| 5.5c | Import the layer files into GarageBand (or Logic / another DAW) | All layers line up from the start, in time with each other | | |
| 5.6 | Does the vocal sit well over the guitar in the final mix? | Clear, not buried, not too loud | | |

---

## 6. Overall impressions

- Did polishing make the demo sound **better**, the **same**, or **worse**? Which layer most?
- Did anything sound **processed or artificial**?
- What did you **expect to be able to do** but couldn't?
- Which words did you type that it **didn't understand**?
- Anything **slow**, **confusing** or **hard to tap**?
- Would you use this to make demos? What's the one thing that would make it worth paying for?

---

## Sending results

- Note results in a copy of this file, or open an issue on the GitHub repo.
- **Send the test recordings (R1–R5)** to David so they can be run through the
  engine for detailed measurements: timing accuracy before and after, noise,
  tempo and key detection, and whether anything misbehaves.
