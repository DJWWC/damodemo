"""DamoDemo prototype - command line entry point.

Example:
  python polish.py \
      --layer takes/guitar.wav:acoustic_guitar \
      --layer takes/vocal.wav:vocal \
      --preset intimate_acoustic \
      --prompt "vocal: warmer and less harsh" \
      --prompt "guitar: tighter" \
      --out output

The first --layer is the timing master (its tempo grid is used for all layers).
"""
import argparse
import json
import os
from datetime import datetime, timezone

import numpy as np
import librosa
import soundfile as sf

import analysis as an
import repair
import song
from chain import default_settings, apply_chain, SOUND_TYPES, PRESETS
from assistant import interpret

SR = 44100


def parse_layer(spec):
    # path:type[:name]  (path may contain ':' on Windows, so split from the right)
    parts = spec.rsplit(":", 2)
    if len(parts) >= 3 and parts[-2] in SOUND_TYPES:
        path, stype, name = parts
    else:
        path, stype = spec.rsplit(":", 1)
        name = stype
    return path, stype, name


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--layer", action="append", required=True,
                    help=f"path:sound_type[:name]. Sound types: {', '.join(SOUND_TYPES)}")
    ap.add_argument("--preset", choices=list(PRESETS), help="style preset applied to every layer")
    ap.add_argument("--prompt", action="append", default=[], help="plain-English adjustment (repeatable)")
    ap.add_argument("--key", help="override detected key, e.g. 'C major' or 'A minor'")
    ap.add_argument("--out", default="output")
    ap.add_argument("--no-song-pass", action="store_true", help="skip the song-level mix pass")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    log = {"created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "statement": "All output audio is derived from the user's own recordings by editing and "
                        "signal processing. No audio was generated, replaced or sent to any server.",
           "layers": {}, "prompts": [], "song_pass": []}

    # ---- 1. load + recognise ----
    layers = {}
    for spec in args.layer:
        path, stype, name = parse_layer(spec)
        y, _ = librosa.load(path, sr=SR, mono=True)
        layers[name] = {"path": path, "type": stype, "raw": y}
        print(f"loaded {name} ({stype}) {len(y)/SR:.1f}s from {path}")

    master = next(iter(layers))
    tempo, grid = an.detect_tempo_grid(layers[master]["raw"], SR)
    n = max(len(l["raw"]) for l in layers.values())
    if args.key:
        tonic, mode = args.key.split()
        key = {"tonic": tonic, "tonic_pc": an.NOTE_NAMES.index(tonic), "mode": mode.lower()}
    else:
        key = an.detect_key(sum(np.pad(l["raw"], (0, n - len(l["raw"]))) for l in layers.values()), SR)
    scale = an.scale_pitch_classes(key)
    log["song"] = {"tempo_bpm": round(tempo, 1), "key": f"{key['tonic']} {key['mode']}", "timing_master": master}
    print(f"song: {tempo:.1f} BPM, key {key['tonic']} {key['mode']} (timing from '{master}')")

    descriptors = {}
    for name, L in layers.items():
        y = L["raw"]
        rec = {"describe": an.describe(y, SR)}
        if L["type"] != "vocal":
            rec["timing"] = an.timing_report(an.detect_onsets(y, SR), grid, SR)
        if L["type"] == "vocal":
            f0, v, hop = an.track_pitch(y, SR)
            rec["pitch"] = an.pitch_report(an.segment_notes(f0, v, hop, SR), scale)
        else:
            rec["chords"] = an.recognise_chords(y, SR, grid[::2])  # per beat
        L["recognised"] = rec
        descriptors[name] = rec
        with open(os.path.join(args.out, f"{name}_recognised.json"), "w") as f:
            json.dump(rec, f, indent=2)

    # ---- 2. settings: sound type + preset + prompts ----
    settings = {name: default_settings(L["type"], args.preset) for name, L in layers.items()}
    for p in args.prompt:
        changes, note, engine = interpret(p, settings, descriptors)
        log["prompts"].append({"prompt": p, "engine": engine, "note": note, "changes": changes})
        print(f"prompt '{p}' [{engine}]: {note}")
        for c in changes:
            print(f"    {c['layer']}.{c['param']}: {c['from']} -> {c['to']}")

    # ---- 3. per-layer beautify ----
    polished = {}
    for name, L in layers.items():
        s = settings[name]
        steps = []
        y, msg = repair.denoise(L["raw"], SR, s["denoise"]); steps.append(msg)
        if s["timing_strength"] > 0:
            y, msg, _ = repair.tighten_timing(y, SR, grid, s["timing_strength"]); steps.append(msg)
        if L["type"] == "vocal" and s["tuning_strength"] > 0:
            y, msg, _ = repair.correct_tuning(y, SR, key, s["tuning_strength"]); steps.append(msg)
        y = apply_chain(y, SR, s)
        if L["type"] == "vocal":  # sustained instruments would pump
            y = repair.gate_gaps(y, SR, s["denoise"])
        steps.append("tone chain: " + ", ".join(f"{k}={v:g}" for k, v in s.items()
                                                 if k not in ("denoise", "timing_strength", "tuning_strength",
                                                              "pan", "width", "level_db")))
        after = {"describe": an.describe(y, SR)}
        if L["type"] != "vocal":
            after["timing"] = an.timing_report(an.detect_onsets(y, SR), grid, SR)
        else:
            f0, v, hop = an.track_pitch(y, SR)
            after["pitch"] = an.pitch_report(an.segment_notes(f0, v, hop, SR), scale)
        sf.write(os.path.join(args.out, f"{name}_polished.wav"), y, SR, subtype="PCM_24")
        polished[name] = {"audio": y, "type": L["type"], "pan": s["pan"], "width": s.get("width", 0.0),
                          "level_db": s.get("level_db", 0.0)}
        log["layers"][name] = {"source": L["path"], "sound_type": L["type"], "settings": s,
                               "steps": steps, "before": L["recognised"], "after": after}
        print(f"polished {name}: " + " | ".join(steps[:-1]))

    # ---- 4. song-level pass ----
    if not args.no_song_pass:
        mixdown, actions = song.mix(polished, SR)
        sf.write(os.path.join(args.out, "song_mix.wav"), mixdown.T, SR, subtype="PCM_24")
        log["song_pass"] = actions
        for a in actions:
            print(f"  song pass: {a}")

    # rough raw mix for A/B comparison
    raw = sum(np.pad(L["raw"], (0, n - len(L["raw"]))) for L in layers.values())
    raw = raw / (np.abs(raw).max() + 1e-9) * 0.7
    sf.write(os.path.join(args.out, "raw_mix.wav"), raw, SR, subtype="PCM_24")

    with open(os.path.join(args.out, "processing_log.json"), "w") as f:
        json.dump(log, f, indent=2, default=float)
    print(f"\ndone -> {args.out}/ (song_mix.wav, raw_mix.wav, *_polished.wav, processing_log.json)")


if __name__ == "__main__":
    main()
