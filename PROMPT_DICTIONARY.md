# LayerPolish prompt dictionary

**Interpreter version 2.** This file is generated from `docs/interpret.js` by `node tools/build_dictionary.mjs > PROMPT_DICTIONARY.md`. Don't edit it by hand: change the vocabulary in `interpret.js`, bump `INTERPRETER_VERSION`, add a `HISTORY` line, and regenerate.

This is the free, offline interpreter in the browser version. It matches words and phrases. It doesn't use AI.

## Version history

| Version | Date | What changed |
|---|---|---|
| 1 | 2026-11-24 | Keyword rules only: 16 phrase groups (warmer, brighter, darker, less harsh, more present, punchier, more dynamic, tighter, looser, more reverb, drier, less noise, grit, left, right, thinner/cleaner). No modifiers: “less warm” made it warmer. |
| 2 | 2026-11-24 | Smarter interpreter: problem words (muddy, nasal, boomy, muffled, distant…), modifiers (less, too, not so, slightly, a lot), character words (vintage, dreamy, lo-fi, telephone…), removal (no reverb, mono, reset), level and width, layer lists (“guitar and vocal”), and explanations for requests it can't do. |

## How a request is read

1. **Split** into requests at `;`, new lines and full stops, then into parts at `,` `and` `but` `then` `plus` `also`.
2. **Target:** a part that names a layer (its name, or its type such as *guitar*, *bass*, *vocal*; vocals also answer to *voice, vox, singer, singing*) applies to that layer. Following parts keep that target until another layer is named. Lists work: *“guitar and vocal brighter”*. If the layer is named at the end (*“warmer and brighter on the vocal”*), earlier parts use it too. *everything, the whole mix, overall, all the layers* targets every layer. With no layer named, a request applies to every layer.
3. **Match** each phrase below. Each part of the text is used once, and earlier tables take priority.
4. **Modifiers** are read from the few words before a phrase:
   - *Qualities* (things you want more of) are **reversed** by: less, not so, not as, not too, reduce, lower, cut, cut the, cut back, cut back the, take away, take out, decrease, tone down, too, fewer, minus, without as much, turn down the. *“less warm”* and *“too bright”* go the other way.
   - *Problems* (things to fix) are fixed whether you say *“muddy”*, *“less muddy”* or *“too muddy”*. They're **reversed** only by: more / add / extra / increase / boost.
   - **Half step:** slightly, a bit, a little bit, a little, a touch, a tad, subtly, gently, marginally, just a.
   - **Bigger step (×1.8):** much, a lot, lots, way, really, very, heaps, massively, loads, super, seriously, hugely, drastically, significantly, extremely, tons.
   - Describing the level as it is (*“the vocal is quiet”*) asks for the opposite (louder). *“make it quieter”* makes it quieter.
5. **Layer + up/down:** *“vocal up”*, *“guitar down 3 dB”* changes the level (2 dB if no number is given).
6. Vocals ignore timing requests, since vocals get no timing correction.
7. Each request is one step. Repeat it to go further. Every value stays within its knob's range (see the end of this file).

## Qualities: things you want more of

“less”, “not so” and “too” reverse these.

| | Phrases | Effect (one step) |
|---|---|---|
| **warm** | warm / warmer / warmth · full / fuller / fullness · thick / thicker · rich / richer / richness · body · round / rounder · meaty · beefy | body (200 Hz) +2 dB, air (10 kHz) −1 dB |
| **bright** | bright / brighter / brightness · sparkl… · air / airy / airier · shimmer… · crisp / crisper / crispy / crispness · sheen · glossy · open-sounding | air (10 kHz) +2 dB, presence (3 kHz) +1 dB |
| **dark** | dark / darker / darkness · mellow / mellower · smooth / smoother · soft-sounding · rounded off · less bite | air (10 kHz) −2 dB, presence (3 kHz) −1 dB, harshness (6.5 kHz) −1 dB |
| **loud** | loud / louder / loudness · turn up / turn it up / turn this up / turn them up … · bring up / bring it up / bring this up / bring them up · boost / boosted · more volume · volume up · up in the mix · push forward / push it forward / push this forward · stand out | level +2 dB |
| **quiet** | quiet / quieter · turn down / turn it down / turn this down / turn them down … · bring down / bring it down / bring this down / bring them down · volume down · down in the mix · sit back / sits back · push back / push it back / push this back · tuck in / tuck it in / tucked in / tucked it in · background · softer | level −2 dB |
| **present** | present · presence · forward · upfront / up front · cut through / cuts through · clear / clearer · clarity · defined / definition · articulate · intelligible · bite · edge | presence (3 kHz) +2 dB, boxiness (350 Hz) −1 dB |
| **denoise** | denois… / de-nois… · clean up the noise · noise reduction | noise clean-up +25% |
| **clean** | clean / cleaner · tidy / tidier · tighter low end · focused | boxiness (350 Hz) −2 dB, body (200 Hz) −0.5 dB, noise clean-up +10% |
| **punchy** | punch / punchy / punchier · tighter dynamics · even / evener · controlled · consistent · glue / glued · compress / compressed / compression · solid | compression ratio +1.5 ratio, compression threshold −4 dB |
| **dynamic** | dynamic · breathe / breathy / breathier · open up / opens up · natural dynamics · room to breathe · more life | compression ratio −1.5 ratio, compression threshold +4 dB |
| **tight** | tight / tighter / tighten · in time · on beat / on the beat · on time · quantis… · quantiz… · locked / locked in · on the grid | timing correction +30% |
| **loose** | loose / looser · human · natural feel · as played · groov… · laid-back · swing | timing correction −30% |
| **reverb** | reverb · verb · spacious · space · roomy · room · hall · ambience · wet / wetter · depth · 3d | reverb +8%, room size +0.15 |
| **dry** | dry / drier / dryer · intimate · close / closer · close-mic… · upfront and dry · in the room with | reverb −8% |
| **wide** | wider / widen / width / wide · stereo · spread · panoramic | stereo width +30% |
| **narrow** | narrow / narrower · centred · centered · focus in the middle / focused in the middle | stereo width −30% |
| **gritty** | grit / gritty / grittier · drive / driven · saturat… · analog / analogue · tape · valve · tube · crunch / crunchy · dirty / dirtier · warm distortion | saturation +3 dB |
| **left** | left | pan −30% (− = left) |
| **right** | right | pan +30% (− = left) |

## Problems: things to fix

Mentioning these fixes them. “more” or “add” reverses them.

| | Phrases | Effect (one step) |
|---|---|---|
| **harsh** | harsh / harshness · sibilan… · essy / essey · sizzl… · spitty · piercing · shrill · brittle · fizzy · ear-ache · grating · sharp | harshness (6.5 kHz) −3 dB, air (10 kHz) −0.5 dB |
| **muddy** | mud / muddy / muddiness · murky · cloudy · woolly · wooly · congested · boxy / boxiness · cardboard | boxiness (350 Hz) −2.5 dB |
| **boomy** | boom / boomy / boominess · rumbl… · bloated · tubby · bass-heavy · too much low / too much bass / too much bottom | body (200 Hz) −2 dB, low cut +30 Hz |
| **nasal** | nasal · nasally · honk / honky · hollow · through the nose / through your nose · cupped | nasal range (1 kHz) −3 dB |
| **tinny** | tinny · cheap-sounding · small-sounding · plasticky · toy | body (200 Hz) +2 dB, presence (3 kHz) −1 dB, harshness (6.5 kHz) −1 dB |
| **thin** | thin · weak · anaemic · anemic · lacks body · no body · wimpy · feeble | body (200 Hz) +2 dB, boxiness (350 Hz) +0.5 dB |
| **muffled** | muffl… · dull · blanket · veiled · smothered · lifeless · flat-sounding · under a pillow · closed-in | presence (3 kHz) +2 dB, air (10 kHz) +2 dB, boxiness (350 Hz) −1 dB |
| **distant** | distant · far away · far back · too far · buried · lost in · hidden · drowned / drowning · behind the · can't hear | level +2 dB, presence (3 kHz) +1.5 dB, reverb −5% |
| **overpowering** | overpower… · dominat… · too prominent · on top of everything · sticks out · swamp… | level −2 dB, presence (3 kHz) −1 dB |
| **sterile** | sterile · clinical · cold · too digital · soulless · robotic | saturation +2 dB, body (200 Hz) +1.5 dB |
| **sloppy** | sloppy · out of time · off beat / off the beat · messy · rushed / rushing · dragged / dragging / drags · uneven timing · timing is off · not in time | timing correction +30% |
| **squashed** | squashed / squashy · over-compress… · pumping · no dynamics · flat dynamics · choked | compression ratio −1.5 ratio, compression threshold +4 dB |
| **noisy** | hiss / hissy · noise / noisy · hum · buzz / buzzy / buzzing · background noise · room noise · fan noise · static | noise clean-up +25% |
| **harsh-distorted** | distorted / distorting · fuzzy · crackl… · clipping · overdriven | saturation −3 dB, harshness (6.5 kHz) −1 dB |
| **too reverby** | washed-out · swimming · reverb soup · too wet · too much reverb / echo · cavernous · bathroom | reverb −10%, room size −0.15 |

## Character words: move several knobs at once

These behave like qualities, so *“less vintage”* reverses them.

| | Phrases | Effect (one step) |
|---|---|---|
| **vintage** | vintage · retro · old-school · old-fashioned · classic | saturation +3 dB, air (10 kHz) −2 dB, body (200 Hz) +1.5 dB |
| **dreamy** | dreamy / dreamier · ethereal · washy / washed out · floaty · atmospheric · ambient | reverb +15%, room size +0.3, air (10 kHz) +1.5 dB, stereo width +30% |
| **aggressive** | aggressive · angry · hard-hitting · ferocious · in-your-face · heavy | compression ratio +2 ratio, compression threshold −6 dB, presence (3 kHz) +2 dB, saturation +3 dB, reverb −6% |
| **lush** | lush · luxurious · velvet / velvety · silky · plush | reverb +8%, body (200 Hz) +1.5 dB, stereo width +20%, air (10 kHz) +1 dB, harshness (6.5 kHz) −1.5 dB |
| **raw** | raw · unprocessed · honest · stripped-back · untouched · organic | timing correction −30%, compression ratio −1 ratio, reverb −6%, saturation −2 dB |
| **lo-fi** | lo-fi · low-fi · cassette · bedroom tape · degraded | air (10 kHz) −3 dB, saturation +4 dB, low cut +60 Hz, presence (3 kHz) −1 dB |
| **polished** | radio-ready · polished · commercial · professional · pro · release-ready · slick · finished | compression ratio +1.5 ratio, compression threshold −4 dB, presence (3 kHz) +1.5 dB, air (10 kHz) +1.5 dB, timing correction +20% |
| **telephone** | telephone · phone · megaphone · walkie-talkie · radio effect · AM radio · like / through a (old / cheap) radio · old radio · transistor | low cut +250 Hz, air (10 kHz) −6 dB, nasal range (1 kHz) +3 dB, presence (3 kHz) +2 dB, body (200 Hz) −4 dB |
| **cosy** | cosy / cosier · cozy / cozier · campfire · fireside · living-room · late-night | body (200 Hz) +1.5 dB, air (10 kHz) −1 dB, reverb −5%, harshness (6.5 kHz) −1 dB |
| **epic** | epic · huge · massive · cinematic · anthemic · stadium · arena · enormous | reverb +10%, room size +0.25, stereo width +30%, body (200 Hz) +1 dB, compression ratio +1 ratio |

## Set or remove

| Phrases | Result |
|---|---|
| no / remove / kill / without / turn off / get rid of / lose / drop + (the / any / all) reverb, verb, room, space, ambience | reverb off |
| no / remove / without / turn off / bypass / lose / drop + (the / any) compression, compressor | compression off |
| no / remove / turn off + timing (correction), quantise · leave the timing · don't fix / touch / change the timing | timing correction off |
| no / remove / without / turn off + saturation, drive, distortion, grit | saturation off |
| no / remove / turn off + noise reduction, noise removal, denoise | noise clean-up off |
| mono | mono (no width) |
| centre · center · centred · centered · middle · pan(ned) centre | panned centre |
| hard left · fully left · all the way left | panned hard left |
| hard right · fully right · all the way right | panned hard right |
| reset · start over · back to default | the layer goes back to the preset's values |

## Requests it recognises but can't do

These show a message instead of silently doing nothing.

| Phrases | Message |
|---|---|
| 8-bit · 16-bit · bit-crush… · chiptune · video game · nintendo · retro game · arcade | “8-bit”/bitcrush needs a bitcrusher effect, which isn't available yet. |
| auto-tune · pitch-correct… · out of tune · off-key · flat notes · sharp notes · in tune · tuning · pitchy | Vocal tuning isn't in the browser version yet (the Python version has it). |
| delay · echo / echoes / echoey · slap-back · ping-pong | Delay/echo isn't available yet. Try “more reverb” for space. |
| chorus effect · flang… · phaser / phasing · tremolo · vibrato · wah · auto-pan · rotary · leslie | Modulation effects (chorus, flanger, phaser, tremolo) aren't available yet. |
| in / during / on / for the chorus, verse, bridge, intro, outro, middle eight, drop, hook, start, end · first verse · second verse | Changes apply to the whole song. Section-by-section edits aren't supported yet. |
| faster · slower · speed up / speed it up · slow down / slow it down · tempo · bpm · half-time · double-time | Changing the tempo isn't supported. LayerPolish keeps your performance at its own speed. |
| transpose · change key / change the key · key change · pitch up / pitch down / pitch it up … · semitone · octave | Changing key or pitch isn't supported. |
| add + drums, beat, bassline, harmony, backing, strings, piano, synth, pad, choir, instrument, vocals, percussion, claps · harmonise · double-track · backing vocals · generate · write · compose · sing | LayerPolish only edits what you recorded, so it won't add or generate new parts. |
| sound(s) like / in the style of / like + a capitalised name (e.g. Like Adele, sounds like Bon Iver) | Sounding like a particular artist needs the Claude version (see DEVELOPMENT.md). For now, describe the sound instead: warmer, drier, brighter… |
| sound(s) like / in the style of / like + a known artist typed in lower case (ed sheeran, taylor swift, adele, billie eilish, coldplay, the beatles, oasis, radiohead, john mayer, bon iver, phoebe bridgers, nirvana, queen) | Sounding like a particular artist needs the Claude version (see DEVELOPMENT.md). For now, describe the sound instead: warmer, drier, brighter… |

## Knob ranges

| Knob | Range | What it is |
|---|---|---|
| noise clean-up (`denoise`) | 0 to 1 | noise reduction strength |
| timing correction (`timing_strength`) | 0 to 1 | how far events are pulled to the beat grid (0 = as played) |
| low cut (`hpf_hz`) | 20 to 300 | high-pass filter: removes rumble below this frequency |
| body (200 Hz) (`warmth_db`) | -6 to 6 | low shelf at 200 Hz: body/warmth |
| boxiness (350 Hz) (`mud_db`) | -8 to 3 | bell at 350 Hz: boxiness/mud (negative = cleaner) |
| presence (3 kHz) (`presence_db`) | -6 to 6 | bell at 3 kHz: clarity/forwardness |
| nasal range (1 kHz) (`nasal_db`) | -8 to 3 | bell at 1 kHz: nasal/honky range (negative = less nasal) |
| harshness (6.5 kHz) (`harshness_db`) | -8 to 2 | bell at 6.5 kHz: harshness/sibilance (negative = smoother) |
| air (10 kHz) (`air_db`) | -6 to 6 | high shelf at 10 kHz: sparkle/air |
| compression threshold (`comp_threshold_db`) | -40 to 0 | compressor threshold |
| compression ratio (`comp_ratio`) | 1 to 8 | compressor ratio (higher = more even/punchy) |
| saturation (`saturation_db`) | 0 to 12 | gentle drive for analogue-style warmth |
| reverb (`reverb_mix`) | 0 to 0.5 | reverb amount |
| room size (`reverb_size`) | 0 to 1 | reverb room size |
| pan (`pan`) | -1 to 1 | stereo position (-1 left, 1 right) |
| stereo width (`width`) | 0 to 1 | stereo width (0 = mono point, 1 = wide) |
| level (`level_db`) | -12 to 12 | level in the mix, relative to the automatic balance |

## Example requests

- *“vocal: warmer and less harsh”*
- *“guitar is too bright”*
- *“the vocal sounds a bit nasal and muddy”*
- *“guitar and vocal: slightly wider”*
- *“I can't hear the vocal”*
- *“make the whole mix more vintage”*
- *“bass down 3 dB”*
- *“vocal: no reverb; guitar: tighter”*
- *“warmer and brighter on the vocal”*
