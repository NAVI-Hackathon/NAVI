"""Score for film.html (tempo from the page, 110 BPM): a stereo arrangement that builds to the 100% drop,
plus every UI sound on its beat.

Usage: python3 film-audio.py score.json out.wav
score.json comes from the page: music sections (bars), events (time, sfx, hit, note) and, for the narrated
version, the narration windows the music ducks under.

The arrangement is built around one motif, E–G–A–C (the four steps of the NAVI icon): bells in the intro,
minor in the pain point, plucked once NAVI appears, doubled in the lift, harmonised at the drop, slow in the
breakdown and on bells again with the logo. Each section has its own drum pattern; the bass moves; pads and
arpeggios pump with the kick; hats, plucks and delays are spread in stereo. Everything is synthesised (no
third-party audio). Instruments and effects come from ../motion/audio.py.
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "motion"))
from audio import (GAIN, RNG, SFX, SR, bass, bell, env, hat, highpass, kick, lowpass, midi, noise, pad,  # noqa: E402
                   pluck, sfx_hit, tone)

BPM = 110  # replaced by the score's tempo in main()
BEAT = 60 / BPM
BAR = 4 * BEAT

PAIN = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]]   # Am7 Fmaj7 Cmaj7 G7
MAIN = [[53, 57, 60, 64], [55, 59, 62, 64], [57, 60, 64, 67], [48, 52, 55, 59]]   # Fmaj7 G6 Am7 Cmaj7
LIFT = [[48, 52, 55, 59], [55, 59, 62, 64], [57, 60, 64, 67], [53, 57, 60, 64]]   # Cmaj7 G6 Am7 Fmaj7
MOTIF = [76, 79, 81, 84]          # E5 G5 A5 C6
MOTIF_MINOR = [69, 72, 74, 76]    # A4 C5 D5 E5
ORDER = ("intro", "pain", "groove", "lift", "build", "drop", "breakdown", "outro")


# ───────── Instruments added for the film ─────────
def snare():
    n = int(0.22 * SR)
    return (tone(190, 0.22, 0.001, 0.05) * 0.35 + highpass(noise(0.22), 1800) * env(n, 0.001, 0.07) * 0.45) * 0.55


def ghost():
    return snare() * 0.22


def clap():
    out = np.zeros(int(0.2 * SR))
    for k, at in enumerate((0.0, 0.011, 0.023)):
        i = int(at * SR)
        x = highpass(noise(0.12), 1200) * env(int(0.12 * SR), 0.0005, 0.03 if k < 2 else 0.08)
        out[i:i + len(x)] += x
    return out * 0.32


def open_hat():
    n = int(0.3 * SR)
    return highpass(noise(0.3), 6500) * env(n, 0.001, 0.12) * 0.12


def shaker():
    n = int(0.06 * SR)
    return band_noise(0.06, 5000, 11000) * env(n, 0.012, 0.02) * 0.07


def band_noise(dur, lo, hi):
    return highpass(lowpass(noise(dur), hi), lo)


def tom(m):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    f = midi(m) * (1 + 0.5 * np.exp(-t * 30))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.12) * 0.4


def crash():
    n = int(2.2 * SR)
    return band_noise(2.2, 4000, 14000) * env(n, 0.002, 0.7) * 0.11


def swell(dur):
    """Reverse cymbal: rises into the next downbeat."""
    return crash()[: int(dur * SR)][::-1] * 1.3


def riser(dur):
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    x = noise(dur)
    out = np.zeros(n)
    for k, (lo, hi) in enumerate([(200, 800), (600, 2400), (1800, 7000)]):
        out += highpass(lowpass(x, hi), lo) * np.clip(t * 1.6 - k * 0.3, 0, 1)
    return out * t ** 2.2 * 0.22


def lead(m, dur, bright=1.0):
    return tone(midi(m), dur, 0.004, 0.35, ((1, 1.0), (2, 0.4 * bright), (3, 0.15 * bright), (4, 0.06))) * 0.12


def keys(chord, dur):
    """Soft bell-piano chord for the breakdown."""
    return sum(tone(midi(m), dur, 0.003, 0.9, ((1, 1.0), (2, 0.18), (4, 0.05))) for m in chord) * 0.06


def step_note(m):
    """The icon's step: a bell note of the motif with a short tick."""
    out = bell(midi(m), 0.9, 0.42)
    tick = tone(midi(m) * 2, 0.05, 0.0005, 0.02) * 0.12
    out[: len(tick)] += tick
    return out


SFX = {**SFX, "step": None}
GAIN = {**GAIN, "step": 0.7}


# ───────── Arrangement ─────────
class Bus:
    """Stereo bus with constant-power pan."""

    def __init__(self, n):
        self.l = np.zeros(n)
        self.r = np.zeros(n)

    def put(self, x, at, gain=1.0, pan=0.0):
        i = int(round(at * SR))
        if i >= len(self.l) or i + len(x) <= 0:
            return
        if i < 0:
            x, i = x[-i:], 0
        x = x[: len(self.l) - i] * gain
        a = (pan + 1) * np.pi / 4
        self.l[i:i + len(x)] += x * np.cos(a)
        self.r[i:i + len(x)] += x * np.sin(a)

    def stereo(self):
        return np.stack([self.l, self.r], axis=1)


def section_of(music, bar):
    return next(name for name in ORDER if music[name][0] <= bar <= music[name][1])


def ping_pong(bus, time_s, feedback=0.42, mix=0.35, taps=5):
    """Dotted-eighth delay bouncing left/right."""
    d = int(time_s * SR)
    l, r = bus.l.copy(), bus.r.copy()
    out_l, out_r = bus.l.copy(), bus.r.copy()
    src = (l + r) / 2
    for k in range(1, taps + 1):
        g = mix * feedback ** (k - 1)
        shifted = np.zeros_like(src)
        shifted[d * k:] = src[: len(src) - d * k]
        (out_l if k % 2 else out_r)[:] += lowpass(shifted, 5000) * g
    bus.l, bus.r = out_l, out_r


def make_music(music, duration):
    total = music["bars"]
    n = int((duration + 3.5) * SR)
    drums, bassb, harm, plucks, leadb = Bus(n), Bus(n), Bus(n), Bus(n), Bus(n)
    kicks = []  # for the pump

    def kick_at(at, gain=1.0):
        drums.put(kick(), at, gain)
        kicks.append(at)

    for bar in range(1, total + 1):
        t0 = (bar - 1) * BAR
        sec = section_of(music, bar)
        lo, hi = music[sec]
        chords = PAIN if sec in ("intro", "pain") else LIFT if sec in ("drop", "outro") else MAIN
        chord = chords[(bar - 1) % 4]
        last = bar == total
        first_of_section = bar == lo
        fill_bar = (bar - lo) % 4 == 3 and bar != hi and sec in ("groove", "lift")

        # Pads: two slightly different voicings, panned wide.
        pad_gain = {"intro": 0.55 + 0.45 * (bar - lo) / max(1, hi - lo), "pain": 0.9, "drop": 1.25, "breakdown": 1.0, "outro": 1.1}.get(sec, 1.0)
        held = 3.0 if last else 0.06
        harm.put(pad(chord, BAR + held), t0, pad_gain, -0.55)
        harm.put(pad([m + (12 if k == 0 else 0) for k, m in enumerate(chord)], BAR + held), t0, pad_gain * 0.8, 0.55)

        # Section entries: a reverse swell into the bar and a crash on it.
        if first_of_section and sec in ("groove", "lift", "drop", "outro"):
            drums.put(swell(BAR * 0.75), t0 - BAR * 0.75, 0.9)
            drums.put(crash(), t0, 1.0, 0.25)

        if sec == "intro":
            if bar == lo:
                for k, m in enumerate(MOTIF):
                    leadb.put(bell(midi(m + 12), 1.4, 0.16), t0 + (k + 1) * BEAT, 1.0, -0.3 + 0.2 * k)
            if bar == lo + 2:
                leadb.put(bell(midi(MOTIF[3] + 12), 2.0, 0.14), t0, 1.0, 0.2)
            continue
        if last:
            bassb.put(bass(chord[0], 3.0), t0)
            for k, m in enumerate(MOTIF):
                leadb.put(bell(midi(m + 12), 2.4 - k * 0.3, 0.16), t0 + k * BEAT * 0.5, 1.0, -0.3 + 0.2 * k)
            continue

        if sec == "pain":
            # Heartbeat kick, sub pulse, the motif in minor on a muted pluck.
            kick_at(t0, 0.7)
            kick_at(t0 + BEAT * 0.75, 0.35)
            for b in range(4):
                bassb.put(bass(chord[0], BEAT * 0.95), t0 + b * BEAT, 0.7)
            if (bar - lo) % 2 == 0:
                for k, m in enumerate(MOTIF_MINOR):
                    plucks.put(lowpass(pluck(m, 0.35), 2500), t0 + (k + 1) * BEAT, 1.1, 0.35 * (-1) ** k)
            continue

        if sec == "breakdown":
            harm.put(keys(chord, BAR * 1.2), t0, 1.0, 0.0)
            bassb.put(bass(chord[0], BAR), t0, 0.7)
            for k, m in enumerate(MOTIF):
                if (bar - lo) % 2 == 0:
                    leadb.put(lead(m, BEAT * 1.8, 0.4), t0 + k * BEAT, 0.8, 0.2)
            continue

        pre_drop = sec == "build" and bar == hi          # the bar before the drop empties out
        # ── Drums: a different pattern per section ──
        if sec == "groove":
            kick_pattern, snare_on, hat_div = [0, 1.5, 2], [], 2
        elif sec == "lift":
            kick_pattern, snare_on, hat_div = [0, 1.5, 2, 3.5], [1, 3], 2
        elif sec == "build":
            kick_pattern, snare_on, hat_div = ([0, 2] if not pre_drop else [0]), [1, 3], 4
        elif sec == "drop":
            kick_pattern, snare_on, hat_div = [0, 1, 2, 3], [1, 3], 4
        else:  # outro
            kick_pattern, snare_on, hat_div = ([0, 1, 2, 3] if bar < hi - 1 else [0]), [1, 3], 2
        for b in kick_pattern:
            kick_at(t0 + b * BEAT)
        for b in snare_on:
            drums.put(clap(), t0 + b * BEAT, 1.0, 0.1)
            if sec in ("drop", "outro"):
                drums.put(snare(), t0 + b * BEAT, 0.6)
        if sec in ("lift", "build", "drop"):
            for g in (0.75, 2.75):
                drums.put(ghost(), t0 + g * BEAT, 1.0, -0.2)
        for h in range(4 * hat_div):
            at = t0 + h * BEAT / hat_div
            off = h % hat_div == hat_div // 2 if hat_div > 1 else False
            drums.put(hat(), at, 1.25 if off else 0.8, 0.35 if h % 2 else -0.35)
        if sec in ("drop", "lift"):
            for b in range(4):
                drums.put(open_hat(), t0 + b * BEAT + BEAT / 2, 0.8 if sec == "lift" else 1.0, 0.3)
        if sec in ("lift", "build", "drop"):
            for k in range(16):
                drums.put(shaker(), t0 + k * BEAT / 4, 1.0 if k % 2 else 0.6, 0.6)
        if fill_bar:
            for k, m in enumerate([50, 47, 45, 43]):
                drums.put(tom(m), t0 + 3 * BEAT + k * BEAT / 4, 1.0, 0.4 - 0.25 * k)

        # ── Bass: moving lines ──
        root = chord[0] - 12 if chord[0] > 52 else chord[0]
        if sec == "groove":
            line = [(0, root, 0.9), (1.5, root, 0.4), (2, root + 7, 0.9), (3, root + 12, 0.4), (3.5, root + 7, 0.4)]
        elif sec in ("lift", "build"):
            line = [(k * 0.5, root + (12 if k % 2 else 0), 0.4) for k in range(8)]
        elif sec == "drop":
            line = [(k * 0.5, root + (12 if k % 2 else 0) + (7 if k == 6 else 0), 0.4) for k in range(8)]
        else:
            line = [(0, root, 1.8), (2, root + 7, 0.9), (3, root + 12, 0.9)]
        for at, m, length in line:
            bassb.put(bass(m + 12, BEAT * length), t0 + at * BEAT, 0.9)

        # ── Arpeggios / motif ──
        steps = 16 if sec == "drop" or (sec == "build" and bar >= hi - 2) else 8
        pattern = [0, 1, 2, 3, 2, 1, 2, 3]
        for e in range(steps):
            m = chord[pattern[e % 8]] + 12 + (12 if sec == "drop" and e % 4 == 3 else 0)
            plucks.put(pluck(m), t0 + e * BAR / steps, 0.75 if sec == "groove" else 0.95, 0.45 * (-1) ** e)
        if sec in ("groove", "lift") and (bar - lo) % 4 == 0:
            for k, m in enumerate(MOTIF):
                leadb.put(pluck(m, 0.4) * 2.2, t0 + k * BEAT, 1.0, 0.0)
                if sec == "lift":
                    leadb.put(pluck(m + 12, 0.4) * 1.3, t0 + k * BEAT, 1.0, 0.3)
        if sec == "drop":
            line = MOTIF if bar != hi else MOTIF[::-1]
            for k, m in enumerate(line):
                leadb.put(lead(m, BEAT * 1.1), t0 + k * BEAT, 1.0, -0.15)
                leadb.put(lead(m - 3 if m != 76 else m - 4, BEAT * 1.1), t0 + k * BEAT, 0.6, 0.15)   # harmony a third below
        if sec == "outro" and bar == lo + 1:
            for k, m in enumerate(MOTIF):
                leadb.put(bell(midi(m + 12), 1.2, 0.16), t0 + k * BEAT, 1.0, -0.3 + 0.2 * k)

    # Build: everything swells, then a riser and a tightening snare roll into the drop.
    b_lo, b_hi = music["build"]
    drop_at = (music["drop"][0] - 1) * BAR
    a, b = int((b_lo - 1) * BAR * SR), int(drop_at * SR)
    ramp = 10 ** (np.linspace(-4, 2, b - a) / 20)
    for bus in (harm, plucks, bassb, leadb):
        bus.l[a:b] *= ramp
        bus.r[a:b] *= ramp
    drums.put(riser(2 * BAR), drop_at - 2 * BAR, 1.0, 0.0)
    for k in range(24):
        frac = k / 24
        drums.put(snare(), drop_at - BAR + BAR * (1 - (1 - frac) ** 1.6), 0.25 + 0.75 * frac, -0.3 + 0.6 * frac)

    # Pump: pads, plucks and bass dip under each kick (sidechain feel).
    pump = np.ones(n)
    shape = 1 - 0.45 * np.exp(-np.arange(int(0.25 * SR)) / (0.07 * SR))
    for k in kicks:
        i = int(k * SR)
        seg = pump[i:i + len(shape)]
        pump[i:i + len(shape)] = np.minimum(seg, shape[: len(seg)])
    for bus in (harm, plucks):
        bus.l *= pump
        bus.r *= pump
    bassb.l *= 0.5 + 0.5 * pump
    bassb.r *= 0.5 + 0.5 * pump

    ping_pong(plucks, BEAT * 0.75)
    ping_pong(leadb, BEAT * 0.75, feedback=0.35, mix=0.28, taps=4)
    mix = sum(bus.stereo() * g for bus, g in ((drums, 1.0), (bassb, 0.9), (harm, 1.0), (plucks, 0.85), (leadb, 1.0)))
    return mix


def reverb(x, seconds=1.4, amount=0.18):
    n = int(seconds * SR)
    out = x.copy()
    for ch, seed in ((0, 1), (1, 2)):
        rng = np.random.default_rng(seed)
        ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.3 * SR))
        ir = lowpass(ir, 6000) * 0.012
        out[:, ch] += fftconvolve(x[:, ch], ir)[: len(x)] * amount / 0.18
    return out


def main():
    score = json.load(open(sys.argv[1]))
    out_path = sys.argv[2]
    duration, music = score["duration"], score["music"]
    global BPM, BEAT, BAR
    BPM = music["bpm"]
    BEAT = 60 / BPM
    BAR = 4 * BEAT
    n = int(round(duration * SR))
    tail = int(3.0 * SR)
    mus = make_music(music, duration)[: n + tail]
    mus = reverb(mus, amount=0.16)

    # Narrated version: the music steps back ~9 dB under each line (no voice is mixed in here).
    depth = np.zeros(len(mus))
    ramp = int(0.15 * SR)
    for v in score.get("vo", []):
        a, b = max(0, int((v["start"] - 0.15) * SR)), min(len(mus), int((v["end"] + 0.2) * SR))
        if b - a <= 2 * ramp:
            continue
        d = np.ones(b - a)
        d[:ramp] = np.linspace(0, 1, ramp)
        d[-ramp:] = np.linspace(1, 0, ramp)
        depth[a:b] = np.maximum(depth[a:b], d)
    mus *= (1 - (1 - 10 ** (-9 / 20)) * depth)[:, None]

    fx = np.zeros(n + tail)
    for e in score["events"]:
        parts = []
        if e["sfx"] == "step":
            parts.append(step_note(e["note"]) * GAIN["step"])
        elif SFX.get(e["sfx"]):
            parts.append(SFX[e["sfx"]]() * GAIN[e["sfx"]])
        if e.get("hit") and e["sfx"] != "boom":
            parts.append(sfx_hit() * 0.6)
        for x in parts:
            peak = int(np.argmax(np.abs(x)))   # align the transient peak, not the start, to the beat
            start = int(round(e["time"] * SR)) - peak
            idx = np.arange(len(x)) + start
            keep = (idx >= 0) & (idx < len(fx))
            np.add.at(fx, idx[keep], x[keep])
    ir_n = int(1.1 * SR)
    ir = RNG.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / (0.22 * SR)) * 0.02
    fx = fx + fftconvolve(fx, ir)[: len(fx)] * 0.6

    mix = np.zeros((n + tail, 2))
    mix[: len(mus)] += mus
    mix += fx[:, None]
    mix = mix[:n]
    fade = int(1.0 * SR)
    mix[-fade:] *= (np.linspace(1, 0, fade) ** 2)[:, None]
    mix = np.tanh(mix * 1.15) / np.tanh(1.15)
    mix *= 10 ** (-1 / 20) / max(1e-9, np.max(np.abs(mix)))
    pcm = (mix * 32767).astype("<i2")
    with wave.open(out_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"Wrote {out_path}: {duration:.2f}s, {score['version']}")


if __name__ == "__main__":
    main()
