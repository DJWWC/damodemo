"""Recognition and measurement: turns a raw take into numbers.

Nothing here changes audio. The outputs are what the app 'understands'
about a layer (tempo, key, notes/chords, timing and pitch accuracy) and
the descriptors the AI assistant is allowed to see instead of the audio.
"""
import numpy as np
import librosa
import pyloudnorm as pyln

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]

# Krumhansl-Schmuckler key profiles
_MAJ_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MIN_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

BANDS = {
    "sub": (20, 80), "low": (80, 250), "low_mid": (250, 600),
    "mid": (600, 2000), "presence": (2000, 5000), "air": (5000, 16000),
}


def detect_tempo_grid(y, sr, subdivision=2):
    """Return tempo (BPM) and a grid of sample positions (beats split into `subdivision`)."""
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="samples")
    tempo = float(np.atleast_1d(tempo)[0])
    if len(beats) < 2:
        step = int(sr * 60 / max(tempo, 1) / subdivision)
        return tempo, np.arange(0, len(y), max(step, 1))
    # Regularise: fit a straight line through beat positions (steady tempo assumption)
    idx = np.arange(len(beats))
    slope, intercept = np.polyfit(idx, beats, 1)
    n = int(np.ceil(len(y) / slope)) + 2
    start_k = int(np.floor(-intercept / slope)) - 1
    beat_pos = intercept + slope * np.arange(start_k, start_k + n)
    grid = np.concatenate([beat_pos[:-1, None] + slope * np.arange(subdivision)[None, :] / subdivision]).ravel()
    grid = grid[(grid >= 0) & (grid < len(y))]
    return 60.0 * sr / slope, grid.astype(int)


def detect_key(y, sr):
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    best = (-np.inf, 0, "major")
    for tonic in range(12):
        for mode, prof in (("major", _MAJ_PROFILE), ("minor", _MIN_PROFILE)):
            r = np.corrcoef(chroma, np.roll(prof, tonic))[0, 1]
            if r > best[0]:
                best = (r, tonic, mode)
    return {"tonic": NOTE_NAMES[best[1]], "tonic_pc": best[1], "mode": best[2]}


def scale_pitch_classes(key):
    steps = MAJOR_SCALE if key["mode"] == "major" else MINOR_SCALE
    return sorted((key["tonic_pc"] + s) % 12 for s in steps)


def detect_onsets(y, sr):
    return librosa.onset.onset_detect(y=y, sr=sr, units="samples", backtrack=True)


def timing_report(onsets, grid, sr):
    if len(onsets) == 0 or len(grid) == 0:
        return {"onsets": 0, "mean_offset_ms": 0.0, "max_offset_ms": 0.0}
    d = np.array([np.min(np.abs(grid - o)) for o in onsets]) / sr * 1000
    return {"onsets": int(len(onsets)), "mean_offset_ms": round(float(d.mean()), 1),
            "max_offset_ms": round(float(d.max()), 1)}


def recognise_chords(y, sr, grid):
    """Template-match major/minor triads on each grid region (guitar/keys layers)."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
    templates = {}
    for r in range(12):
        for q, ints in (("", (0, 4, 7)), ("m", (0, 3, 7))):
            t = np.zeros(12)
            t[[(r + i) % 12 for i in ints]] = 1
            templates[NOTE_NAMES[r] + q] = t / np.linalg.norm(t)
    frames = librosa.samples_to_frames(grid, hop_length=512)
    out, last = [], None
    for a, b in zip(frames[:-1], frames[1:]):
        seg = chroma[:, a:max(b, a + 1)].mean(axis=1)
        if seg.sum() < 1e-6:
            continue
        seg = seg / (np.linalg.norm(seg) + 1e-9)
        name = max(templates, key=lambda k: templates[k] @ seg)
        if name != last:
            out.append({"time_s": round(float(librosa.frames_to_time(a, sr=sr, hop_length=512)), 2), "chord": name})
            last = name
    return out


def track_pitch(y, sr):
    f0, voiced, _ = librosa.pyin(y, fmin=70, fmax=1000, sr=sr, frame_length=2048, hop_length=256)
    return f0, voiced, 256


def segment_notes(f0, voiced, hop, sr, min_frames=6):
    """Group voiced pitch frames into notes. Returns list of (start_sample, end_sample, median_midi)."""
    midi = librosa.hz_to_midi(np.where(voiced, f0, np.nan))
    notes, start, run = [], None, []
    for i, m in enumerate(midi):
        if np.isnan(m):
            if start is not None and len(run) >= min_frames:
                notes.append((start * hop, i * hop, float(np.median(run))))
            start, run = None, []
            continue
        if start is None:
            start, run = i, [m]
        elif abs(m - np.median(run)) > 0.7:  # pitch jumped -> new note
            if len(run) >= min_frames:
                notes.append((start * hop, i * hop, float(np.median(run))))
            start, run = i, [m]
        else:
            run.append(m)
    if start is not None and len(run) >= min_frames:
        notes.append((start * hop, len(midi) * hop, float(np.median(run))))
    return notes


def nearest_scale_midi(m, scale_pcs):
    base = int(np.floor(m))
    cands = [n for n in range(base - 2, base + 3) if n % 12 in scale_pcs]
    return min(cands, key=lambda n: abs(n - m))


def pitch_report(notes, scale_pcs):
    if not notes:
        return {"notes": 0, "mean_cents_off": 0.0, "max_cents_off": 0.0, "melody": []}
    offs = [abs(m - nearest_scale_midi(m, scale_pcs)) * 100 for _, _, m in notes]
    melody = [NOTE_NAMES[nearest_scale_midi(m, scale_pcs) % 12] for _, _, m in notes]
    return {"notes": len(notes), "mean_cents_off": round(float(np.mean(offs)), 1),
            "max_cents_off": round(float(np.max(offs)), 1), "melody": melody[:32]}


def loudness(y, sr):
    meter = pyln.Meter(sr)
    data = y.T if y.ndim == 2 else y
    try:
        return float(meter.integrated_loudness(data))
    except ValueError:
        return -70.0


def band_balance(y, sr):
    """Energy per band in dB relative to total - the 'tonal fingerprint' the AI sees."""
    mono = y.mean(axis=0) if y.ndim == 2 else y
    S = np.abs(librosa.stft(mono, n_fft=4096)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
    total = S.sum() + 1e-12
    return {k: round(float(10 * np.log10(S[(freqs >= lo) & (freqs < hi)].sum() / total + 1e-12)), 1)
            for k, (lo, hi) in BANDS.items()}


def noise_floor_db(y):
    frame = 2048
    n = len(y) // frame
    if n < 4:
        return -90.0
    rms = np.sqrt((y[: n * frame].reshape(n, frame) ** 2).mean(axis=1) + 1e-12)
    return round(float(20 * np.log10(np.percentile(rms, 10))), 1)


def describe(y, sr):
    mono = y.mean(axis=0) if y.ndim == 2 else y
    cent = float(librosa.feature.spectral_centroid(y=mono, sr=sr).mean())
    return {"lufs": round(loudness(y, sr), 1), "brightness_hz": round(cent),
            "noise_floor_db": noise_floor_db(mono), "peak_db": round(float(20 * np.log10(np.abs(y).max() + 1e-9)), 1),
            "bands_db": band_balance(y, sr)}
