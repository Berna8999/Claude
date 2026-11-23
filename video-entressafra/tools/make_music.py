"""Original background track for the Waze Entressafra 26/27 video.

Synthesised from scratch with numpy (no samples): D major, 100 BPM,
progression D - A - Bm - G. Pad + plucked arpeggio + sub bass + soft kick/hat.
The track is ducked under the narration clips listed in VO.
Usage: python3 tools/make_music.py  (run from the project root)
"""
import subprocess
import wave

import numpy as np

SR = 44100
DUR = 55.0
BPM = 100
BEAT = 60 / BPM
N = int(SR * DUR)
t_all = np.arange(N) / SR

# (start seconds, file) — must match the <audio> tags in index.html
VO = [(0.6, "vo1"), (3.8, "vo2"), (10.0, "vo3"), (17.2, "vo4"), (23.9, "vo5"),
      (31.6, "vo6"), (38.8, "vo7"), (44.3, "vo8"), (49.6, "vo9")]

def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)

# chords as MIDI notes (D, A, Bm, G)
CHORDS = [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62]]
ROOTS = [38, 33, 35, 31]
BAR = 4 * BEAT

def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):  # simple one-pole
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y

def add(buf, start, sig):
    i = int(start * SR)
    if i >= N:
        return
    j = min(N, i + len(sig))
    buf[i:j] += sig[: j - i]

pad = np.zeros(N)
arp = np.zeros(N)
bass = np.zeros(N)
drums = np.zeros(N)

nbars = int(np.ceil(DUR / BAR))
for b in range(nbars):
    start = b * BAR
    ch = CHORDS[b % 4]
    # pad: detuned saw-ish (sum of harmonics), slow attack/release
    L = int((BAR + 0.6) * SR)
    t = np.arange(L) / SR
    env = np.minimum(1, t / 0.5) * np.minimum(1, np.maximum(0, (BAR + 0.6 - t) / 0.6))
    sig = np.zeros(L)
    for n in ch + [ch[0] + 12]:
        for det in (-0.12, 0.12):
            f = midi(n + det)
            for h in range(1, 6):
                sig += np.sin(2 * np.pi * f * h * t) / (h * 1.6)
    add(pad, start, sig * env * 0.018)
    # sub bass: root on each beat, from the hero hit onward
    if start >= 3.4:
        for k in range(4):
            Lb = int(BEAT * 0.9 * SR)
            tb = np.arange(Lb) / SR
            eb = np.exp(-tb * 3) * np.minimum(1, tb / 0.01)
            f = midi(ROOTS[b % 4])
            add(bass, start + k * BEAT, (np.sin(2 * np.pi * f * tb) + 0.3 * np.sin(4 * np.pi * f * tb)) * eb * 0.22)
    # arpeggio: 8th notes cycling chord tones, up an octave
    seq = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12, ch[0] + 24, ch[2] + 12, ch[1] + 12, ch[2] + 12]
    if start >= 3.4:
        for k in range(8):
            La = int(0.45 * SR)
            ta = np.arange(La) / SR
            ea = np.exp(-ta * 9) * np.minimum(1, ta / 0.003)
            f = midi(seq[k])
            s = np.sin(2 * np.pi * f * ta) + 0.35 * np.sin(4 * np.pi * f * ta) + 0.12 * np.sin(6 * np.pi * f * ta)
            add(arp, start + k * BEAT / 2, s * ea * 0.07)
    # drums: kick on 1 and 3, hat on off-beats (after the intro, quieter in last bar)
    if start >= 3.4:
        for k in range(4):
            bt = start + k * BEAT
            if k in (0, 2):
                Lk = int(0.35 * SR)
                tk = np.arange(Lk) / SR
                fk = 45 + 90 * np.exp(-tk * 30)
                kick = np.sin(2 * np.pi * np.cumsum(fk) / SR) * np.exp(-tk * 9)
                add(drums, bt, kick * 0.35)
            Lh = int(0.06 * SR)
            th = np.arange(Lh) / SR
            rng = np.random.default_rng(b * 10 + k)  # seeded: deterministic
            hat = np.diff(rng.standard_normal(Lh + 1)) * np.exp(-th * 70)
            add(drums, bt + BEAT / 2, hat * 0.035)

pad = lowpass(pad, 1800)
music = pad + arp + bass + drums

# fades
fade_in = np.minimum(1, t_all / 1.5)
fade_out = np.minimum(1, np.maximum(0, (DUR - t_all) / 2.0))
music *= fade_in * fade_out

# duck under narration
def read_wav(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

voice = np.zeros(N)
for st, name in VO:
    v = np.abs(read_wav(f"assets/audio/{name}.wav"))
    add(voice, st, v)
win = int(0.15 * SR)
envv = np.convolve(voice, np.ones(win) / win, mode="same")
active = (envv > 0.02).astype(float)
# smooth gain: 1.0 when silent, 0.45 under speech (~ -7 dB)
gain = 1 - 0.55 * active
k = int(0.25 * SR)
gain = np.convolve(gain, np.ones(k) / k, mode="same")
music *= gain

music /= np.max(np.abs(music)) + 1e-9
music *= 0.9
pcm = (np.stack([music, music], axis=1) * 32767).astype(np.int16)
with wave.open("assets/audio/music.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("ok", len(music) / SR)
