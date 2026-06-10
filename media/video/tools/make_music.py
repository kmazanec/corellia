"""Synthesize the score stems for the Corellia explainer.

Stems (44.1k mono 16-bit, headroom ~-12 dB):
  pulse.wav          low synth pulse ~52 bpm, 64s loopable      (S1-3, 5-9 bed)
  pulse-fast.wav     same figure, double subdivision, 56s       (S11 bed)
  fugue-cadence.wav  two-voice figure resolving to a cadence    (S3)
  cadence-warm.wav   slower, warmer reprise of the cadence      (S12-13)
  shepard.wav        rising Shepard step-canon, ends mid-rise   (S4)
  clunk.wav          single soft percussive hit                 (S10 hard hat)
"""
import numpy as np
import wave
from pathlib import Path

SR = 44100
OUT = Path(__file__).resolve().parent.parent / "assets" / "music"
OUT.mkdir(parents=True, exist_ok=True)


def write(name: str, x: np.ndarray, gain: float = 0.25) -> None:
    x = x / (np.max(np.abs(x)) + 1e-9) * gain
    pcm = (x * 32767).astype(np.int16)
    with wave.open(str(OUT / name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{name}: {len(x)/SR:.1f}s")


def t(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def env(n: int, a: float, d: float) -> np.ndarray:
    """Attack/decay envelope over n samples (seconds)."""
    e = np.ones(n)
    na, nd = int(a * SR), int(d * SR)
    if na:
        e[:na] = np.linspace(0, 1, na)
    if nd:
        e[-nd:] *= np.linspace(1, 0, nd)
    return e


def tone(freq: float, dur: float, harmonics=((1, 1.0), (2, 0.35), (3, 0.12), (4, 0.05))) -> np.ndarray:
    tt = t(dur)
    x = sum(a * np.sin(2 * np.pi * freq * h * tt) for h, a in harmonics)
    return x


def lowpass(x: np.ndarray, alpha: float = 0.015) -> np.ndarray:
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):  # one-pole; fine at these lengths
        acc += alpha * (v - acc)
        y[i] = acc
    return y


# ---- pulse beds ----------------------------------------------------------
def make_pulse(dur: float, bpm: float, name: str) -> None:
    beat = 60.0 / bpm
    n = int(dur * SR)
    x = np.zeros(n)
    # low drone: A1 + fifth, very quiet
    tt = t(dur)
    drone = 0.5 * np.sin(2 * np.pi * 55 * tt) + 0.2 * np.sin(2 * np.pi * 82.5 * tt)
    drone *= 0.35 * (1 + 0.1 * np.sin(2 * np.pi * 0.05 * tt))  # slow swell
    x += drone
    # pulse: soft filtered thump each beat, alternating A1/E2
    k = 0
    pos = 0.0
    while pos < dur - 1.0:
        f = 55.0 if k % 2 == 0 else 41.2  # A1 / E1
        d = beat * 0.9
        seg = tone(f, d, harmonics=((1, 1.0), (2, 0.2))) * env(int(d * SR), 0.01, d * 0.7)
        i = int(pos * SR)
        x[i : i + len(seg)] += seg * 0.8
        pos += beat
        k += 1
    x = lowpass(x, 0.03)
    x *= env(n, 0.5, 1.0)
    write(name, x, gain=0.22)


# ---- fugue cadence -------------------------------------------------------
NOTE = {"A2": 110.0, "B2": 123.47, "C3": 130.81, "D3": 146.83, "E3": 164.81,
        "F3": 174.61, "G3": 196.0, "A3": 220.0, "B3": 246.94, "C4": 261.63,
        "D4": 293.66, "E4": 329.63, "F4": 349.23, "G4": 392.0, "A4": 440.0,
        "E2": 82.41, "G#3": 207.65, "C#4": 277.18}


def voice(notes, step: float, total: float) -> np.ndarray:
    x = np.zeros(int(total * SR))
    pos = 0.0
    for nm, beats in notes:
        d = step * beats
        if nm != "R":
            seg = tone(NOTE[nm], d) * env(int(d * SR), 0.02, min(0.25, d * 0.5))
            i = int(pos * SR)
            x[i : i + len(seg)] += seg
        pos += d
    return x


def make_cadence(step: float, name: str, final_hold: float) -> None:
    # subject: rising-falling figure in A minor; answer enters a bar later a fifth up
    subject = [("A3", 1), ("C4", 1), ("E4", 1), ("D4", 1), ("C4", 1), ("B3", 1), ("C4", 1), ("A3", 1)]
    answer = [("R", 2), ("E4", 1), ("G4", 1), ("A4", 1), ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1), ("E4", 1)]
    bass = [("A2", 4), ("F3", 2), ("G3", 2), ("E3", 2)]
    body = step * 12
    total = body + final_hold
    x = voice(subject, step, total) + 0.8 * voice(answer, step, total) + 0.9 * voice(bass, step, total)
    # final cadence chord: E -> A (V-i resolution), warm A minor with picardy-ish openness (A-E-A-C)
    i = int(body * SR)
    for f, a in ((110.0, 1.0), (164.81, 0.7), (220.0, 0.8), (261.63, 0.45)):
        seg = tone(f, final_hold) * env(int(final_hold * SR), 0.04, final_hold * 0.8) * a
        seg = seg[: len(x) - i]
        x[i : i + len(seg)] += seg
    x = lowpass(x, 0.08)
    write(name, x, gain=0.24)


# ---- Shepard riser -------------------------------------------------------
def make_shepard(dur: float, name: str) -> None:
    n = int(dur * SR)
    tt = t(dur)
    x = np.zeros(n)
    step_len = 0.75  # seconds per chromatic step
    n_oct = 6
    f_lo = 32.7  # C1
    center = np.log2(f_lo) + n_oct / 2
    sigma = 1.1  # octaves, spectral envelope width
    steps = int(dur / step_len) + 1
    for s in range(steps):
        # each step starts one semitone higher; octave-stacked partials
        i0 = int(s * step_len * SR)
        d = step_len * 1.6  # overlap for legato
        seg_n = min(int(d * SR), n - i0)
        if seg_n <= 0:
            break
        ts = np.arange(seg_n) / SR
        semitone = s % 12
        for o in range(n_oct):
            f = f_lo * (2 ** (o + semitone / 12.0))
            w = np.exp(-((np.log2(f) - center) ** 2) / (2 * sigma**2))
            e = np.sin(np.pi * np.minimum(ts / d, 1.0)) ** 2
            x[i0 : i0 + seg_n] += w * e * np.sin(2 * np.pi * f * ts)
    x *= env(n, 1.5, 0.02)  # abrupt end: cut mid-rise
    write(name, x, gain=0.18)


# ---- clunk ---------------------------------------------------------------
def make_clunk() -> None:
    d = 0.5
    tt = t(d)
    body = np.sin(2 * np.pi * (75 - 30 * tt / d) * tt) * np.exp(-tt * 18)
    knock = np.random.default_rng(7).normal(0, 1, len(tt)) * np.exp(-tt * 90) * 0.4
    write("clunk.wav", lowpass(body + knock, 0.12), gain=0.5)


make_pulse(64, 52, "pulse.wav")
make_pulse(56, 104, "pulse-fast.wav")
make_cadence(0.42, "fugue-cadence.wav", 3.0)   # ~8s: brisk figure, resolves
make_cadence(0.62, "cadence-warm.wav", 6.0)    # ~13.4s: slower, longer hold
make_shepard(36, "shepard.wav")
make_clunk()
print("all stems written to", OUT)
