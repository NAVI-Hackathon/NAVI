"""Soundtrack + UI sound effects for navi-motion.html, synthesised (no third-party audio, no licensing).

Usage: python3 audio.py score.json out.wav
score.json comes from the page (window.SCORE): every event's time and sound. Each effect is aligned by
its measured transient PEAK, not its start. The loop version wraps its tail into the start, so it loops
without a click; the intro version ends on a held chord and a final hit.
"""
import json
import sys
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48_000
RNG = np.random.default_rng(7)  # deterministic noise
BPM, BEAT = 120, 0.5


def env(n, attack, decay, sustain=0.0):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * (sustain + (1 - sustain) * np.exp(-t / max(decay, 1e-4)))


def tone(freq, dur, attack=0.005, decay=0.3, partials=((1, 1.0),), sustain=0.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    wave_ = sum(a * np.sin(2 * np.pi * freq * k * t) for k, a in partials)
    return wave_ * env(n, attack, decay, sustain)


def noise(dur):
    return RNG.standard_normal(int(dur * SR))


def band(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)


def lowpass(x, f, order=2):
    return sosfilt(butter(order, f, btype="low", fs=SR, output="sos"), x)


def highpass(x, f, order=2):
    return sosfilt(butter(order, f, btype="high", fs=SR, output="sos"), x)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


# ───────── Sound effects ─────────
def sfx_click():
    n = int(0.06 * SR)
    body = tone(2600, 0.06, 0.0005, 0.012) * 0.5 + tone(900, 0.06, 0.0005, 0.02) * 0.35
    snap = highpass(noise(0.06), 3000) * env(n, 0.0003, 0.004) * 0.6
    return body + snap


def sfx_type():
    return sfx_click()[: int(0.04 * SR)] * 0.35 * (0.8 + 0.4 * RNG.random())


def sfx_whoosh(length=0.42):
    n = int(length * SR)
    x = noise(length)
    t = np.linspace(0, 1, n)
    # Sweep the band upwards; envelope swells to a peak two thirds in, then falls.
    out = np.zeros(n)
    for i, (lo, hi) in enumerate([(300, 900), (700, 2200), (1500, 5000)]):
        out += band(x, lo, hi) * np.clip(np.sin(np.pi * np.clip(t * 1.5 - i * 0.18, 0, 1)), 0, 1) ** 2
    return out * np.sin(np.pi * t) ** 1.5 * 0.55


def sfx_pop():
    dur = 0.12
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 620 * np.exp(-t * 18) + 170
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.05) * 0.8


def sfx_scrub():
    n = int(0.14 * SR)
    return highpass(noise(0.14), 2500) * env(n, 0.03, 0.05) * np.linspace(1, 0.3, n) * 0.35


def sfx_shutter():
    # Camera shutter: two mechanical clicks 55 ms apart with a short noise burst.
    out = np.zeros(int(0.2 * SR))
    for at, amp in ((0.0, 1.0), (0.055, 0.7)):
        i = int(at * SR)
        c = band(noise(0.03), 1800, 7000) * env(int(0.03 * SR), 0.0003, 0.006) * amp
        c += tone(1400, 0.03, 0.0003, 0.008) * 0.4 * amp
        out[i:i + len(c)] += c
    out += band(noise(0.2), 500, 3000) * env(len(out), 0.002, 0.03) * 0.25
    return out * 0.9


def sfx_tick():
    return tone(1760, 0.05, 0.0005, 0.018, ((1, 1.0), (2, 0.3))) * 0.45


def bell(freq, dur=0.6, amp=0.5):
    return tone(freq, dur, 0.002, 0.22, ((1, 1.0), (2.76, 0.25), (5.4, 0.08))) * amp


def sfx_success():
    a, b = bell(midi(88), 0.7, 0.45), bell(midi(95), 0.9, 0.4)
    out = np.zeros(int(0.09 * SR) + len(b))
    out[: len(a)] += a
    out[int(0.09 * SR):] += b
    return out


def sfx_notify():
    notes = [(0.0, 84), (0.07, 88), (0.14, 91)]
    out = np.zeros(int(0.14 * SR) + int(0.7 * SR))
    for at, m in notes:
        b = bell(midi(m), 0.7, 0.32)
        i = int(at * SR)
        out[i:i + len(b)] += b
    return out


def sfx_hit():
    """The heavy “咚”: sub drop + body + click transient."""
    dur = 0.7
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 46 + 90 * np.exp(-t * 22)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.28)
    click = band(noise(dur), 1500, 6000) * env(n, 0.0003, 0.006) * 0.35
    return (sub * 0.95 + click) * 0.9


def sfx_boom():
    n = int(1.6 * SR)
    out = lowpass(noise(1.6), 400)[:n] * env(n, 0.005, 0.5) * 0.12
    hit = sfx_hit() * 1.1
    out[: len(hit)] += hit
    return out


SFX = {
    "click": sfx_click, "type": sfx_type, "whoosh": sfx_whoosh, "pop": sfx_pop, "scrub": sfx_scrub,
    "shutter": sfx_shutter, "tick": sfx_tick, "success": sfx_success, "notify": sfx_notify, "boom": sfx_boom,
    "downbeat": None,
}
GAIN = {"click": 0.55, "type": 0.5, "whoosh": 0.5, "pop": 0.5, "scrub": 0.4, "shutter": 0.75, "tick": 0.45,
        "success": 0.55, "notify": 0.5, "boom": 0.9}


# ───────── Music: minimal 120 BPM bed ─────────
CHORDS = [[53, 57, 60, 64], [57, 60, 64, 67], [48, 52, 55, 59], [55, 59, 62, 64],
          [53, 57, 60, 64], [57, 60, 64, 67], [55, 59, 62, 65], [53, 57, 60, 64]]  # Fmaj7 Am7 Cmaj7 G6 … G7 → F


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 50 + 70 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.12) * 0.7


def hat():
    n = int(0.05 * SR)
    return highpass(noise(0.05), 7000) * env(n, 0.0005, 0.012) * 0.12


def pad(chord, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for m in chord:
        f = midi(m)
        for det in (-0.12, 0.12):  # soft detuned saw-ish (few partials)
            ff = f * 2 ** (det / 12)
            x += sum(np.sin(2 * np.pi * ff * k * t) / k for k in range(1, 6))
    x = lowpass(x, 1400) / (len(chord) * 4)
    fade = np.minimum(1, np.minimum(t / 0.25, (dur - t) / 0.2))
    return x * np.clip(fade, 0, 1) * 0.16


def pluck(m, dur=0.22):
    return tone(midi(m), dur, 0.002, 0.07, ((1, 1.0), (2, 0.35), (3, 0.12))) * 0.13


def bass(m, dur):
    return tone(midi(m - 12), dur, 0.004, 0.18, ((1, 1.0), (2, 0.25))) * 0.32


def music(bars, held_last=False):
    out = np.zeros(int((bars * 4 * BEAT + 2.5) * SR))

    def put(x, at, pan=0.0):
        i = int(round(at * SR))
        out[i:i + len(x)] += x[: len(out) - i]

    for bar in range(bars):
        chord = CHORDS[bar % len(CHORDS)]
        t0 = bar * 4 * BEAT
        last = held_last and bar == bars - 1
        put(pad(chord, 4 * BEAT + (1.5 if last else 0.05)), t0)
        if last:
            put(bass(chord[0], 2.0), t0)
            continue
        for b in range(4):
            if b in (0, 2):
                put(kick(), t0 + b * BEAT)
            put(hat(), t0 + b * BEAT + BEAT / 2)
            put(bass(chord[0], BEAT * 0.9), t0 + b * BEAT)
        for e in range(8):  # eighth-note arpeggio
            put(pluck(chord[[0, 1, 2, 3, 2, 1, 2, 3][e]] + 12), t0 + e * BEAT / 2)
    return out


def main():
    score = json.load(open(sys.argv[1]))
    out_path = sys.argv[2]
    duration, version = score["duration"], score["version"]
    loop = version == "loop"
    bars = int(round(duration / (4 * BEAT)))
    n = int(round(duration * SR))
    tail = int(2.5 * SR)
    mus = music(bars, held_last=not loop)
    fx = np.zeros(n + tail)

    for e in score["events"]:
        maker = SFX.get(e["sfx"])
        parts = []
        if maker:
            parts.append(maker() * GAIN[e["sfx"]])
        if e.get("hit") and e["sfx"] != "boom":
            parts.append(sfx_hit() * 0.75)
        for x in parts:
            peak = int(np.argmax(np.abs(x)))
            start = int(round(e["time"] * SR)) - peak
            idx = np.arange(len(x)) + start
            if loop:
                idx %= n  # wrap pre-roll / tail around the loop point
                np.add.at(fx, idx, x)
            else:
                keep = (idx >= 0) & (idx < len(fx))
                np.add.at(fx, idx[keep], x[keep])

    # A touch of room on the effects bus.
    ir_n = int(0.9 * SR)
    ir = RNG.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / (0.18 * SR)) * 0.02
    fx = fx + fftconvolve(fx, ir)[: len(fx)] * 0.6

    mix = np.zeros(n + tail)
    mix[: len(mus)] += mus[: n + tail]
    mix += fx
    if loop:
        # Fold everything that rings past the end back onto the start: seamless when looped.
        body = mix[:n].copy()
        body[:tail] += mix[n:n + tail]
        mix = body
    else:
        mix = mix[:n]
        fade = int(0.35 * SR)
        mix[-fade:] *= np.linspace(1, 0, fade) ** 2

    mix = np.tanh(mix * 1.1) / np.tanh(1.1)
    mix *= 10 ** (-1 / 20) / max(1e-9, np.max(np.abs(mix)))
    stereo = np.stack([mix, mix], axis=1)
    pcm = (stereo * 32767).astype("<i2")
    with wave.open(out_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"Wrote {out_path}: {duration:.2f}s, {version}")


if __name__ == "__main__":
    main()
