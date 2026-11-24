"""Generate two deliberately sloppy test takes so the pipeline can be tried
without a microphone: a strummed guitar (loose timing, hiss) and a
synthetic 'vocal' (off-pitch notes, loose timing, hiss).

These are crude synth stand-ins, not realistic instruments - use real
recordings to judge sound quality.
"""
import os
import numpy as np
import soundfile as sf

SR = 44100
BPM = 90
rng = np.random.default_rng(7)
BEAT = 60 / BPM
BARS = 8
LEN = int((BARS * 4 * BEAT + 2) * SR)

CHORDS = {"C": [48, 52, 55, 60, 64], "G": [43, 47, 50, 55, 59, 67],
          "Am": [45, 52, 57, 60, 64], "F": [41, 48, 53, 57, 60]}
PROG = ["C", "G", "Am", "F"] * 2


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def pluck(freq, dur, decay=0.996):
    """Karplus-Strong plucked string."""
    n = int(dur * SR)
    period = max(int(SR / freq), 2)
    buf = rng.uniform(-1, 1, period)
    out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % period]
        buf[i % period] = decay * 0.5 * (buf[i % period] + buf[(i + 1) % period])
    return out


def guitar():
    y = np.zeros(LEN)
    cache = {}
    for bar, ch in enumerate(PROG):
        for beat in range(4):
            t = (bar * 4 + beat) * BEAT + 0.5 + rng.normal(0, 0.035)  # sloppy timing
            down = beat % 2 == 0
            notes = CHORDS[ch] if down else CHORDS[ch][::-1]
            for j, m in enumerate(notes):
                key = m
                if key not in cache:
                    cache[key] = pluck(mtof(m), 1.6)
                s = int((t + j * 0.012) * SR)
                seg = cache[key] * (0.9 if down else 0.6)
                e = min(s + len(seg), LEN)
                y[s:e] += seg[: e - s]
    y += rng.normal(0, 0.004, LEN)  # hiss
    return (y / np.abs(y).max() * 0.6).astype(np.float32)


def vocal():
    # C major melody, one note per half bar
    melody = [64, 67, 69, 67, 64, 62, 60, 62, 64, 67, 72, 71, 69, 67, 64, 60]
    y = np.zeros(LEN)
    for i, m in enumerate(melody):
        start = 0.5 + i * 2 * BEAT + rng.normal(0, 0.04)
        dur = 2 * BEAT * 0.85
        cents = rng.choice([-1, 1]) * rng.uniform(15, 45)  # off pitch
        f = mtof(m + cents / 100)
        t = np.arange(int(dur * SR)) / SR
        vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t / 0.3, 0, 1)
        phase = 2 * np.pi * np.cumsum(f * vib) / SR
        tone = sum((0.8 / k) * np.sin(k * phase) for k in range(1, 9))
        env = np.clip(t / 0.06, 0, 1) * np.clip((dur - t) / 0.12, 0, 1)
        s = int(start * SR)
        y[s: s + len(t)] += tone * env
    y += rng.normal(0, 0.006, LEN)  # mic hiss
    return (y / np.abs(y).max() * 0.6).astype(np.float32)


if __name__ == "__main__":
    os.makedirs("demo_takes", exist_ok=True)
    sf.write("demo_takes/guitar.wav", guitar(), SR)
    sf.write("demo_takes/vocal.wav", vocal(), SR)
    print("wrote demo_takes/guitar.wav and demo_takes/vocal.wav")
