"""Original procedural janggi Foley assets. No external samples or generation service.
Run from any directory with Python, NumPy and SciPy installed.
"""
from pathlib import Path
import json
import wave
import numpy as np
from scipy.signal import butter, sosfilt

PROJECT = Path(__file__).resolve().parents[2]
ROOT = PROJECT / 'public' / 'audio'
REPORT_ROOT = PROJECT / 'docs' / 'audio'
ROOT.mkdir(parents=True, exist_ok=True)
REPORT_ROOT.mkdir(parents=True, exist_ok=True)
SR = 48000
PEAK = 10 ** (-3 / 20)

def filtered_noise(n, rng, low=150, high=10000):
    return sosfilt(butter(2, [low, min(high, SR * .46)], btype='bandpass', fs=SR, output='sos'), rng.normal(0, 1, n))

def impact(kind, variation):
    rng = np.random.default_rng(20261113 + variation * 43 + len(kind) * 997)
    length = {'hitSoft': .105, 'hitMedium': .16, 'hitHard': .225, 'hinge': .255, 'flick': .115}[kind]
    t = np.arange(round(length * SR)) / SR
    pitch = 1 + (variation - 1) * .035
    if kind == 'flick':
        x = filtered_noise(len(t), rng, 700, 11500) * np.exp(-t / .023) * .33
        # A finger's brief grainy slide, then a tiny release click.
        x += filtered_noise(len(t), rng, 900, 4000) * np.exp(-((t - .016) / .011) ** 2) * .22
        x += np.sin(2 * np.pi * 1050 * t) * np.exp(-t / .006) * .075
    elif kind == 'hinge':
        x = filtered_noise(len(t), rng, 600, 15000) * np.exp(-t / .006) * .52
        for freq, gain, decay in [(1660, .19, .045), (2795, .13, .035), (4510, .075, .023), (6320, .035, .014)]:
            x += np.sin(2 * np.pi * freq * pitch * t) * np.exp(-t / decay) * gain
        x += filtered_noise(len(t), rng, 65, 500) * np.exp(-t / .055) * .22
    else:
        modes = {
            'hitSoft': [(740, .25, .009), (1710, .16, .006), (3250, .09, .004)],
            'hitMedium': [(280, .28, .021), (670, .23, .015), (1470, .15, .008), (2840, .06, .006)],
            'hitHard': [(130, .32, .043), (315, .29, .027), (780, .17, .018), (1680, .11, .009), (3050, .045, .005)],
        }[kind]
        crack = filtered_noise(len(t), rng, 1100, 14000) * np.exp(-t / (.0037 if kind == 'hitSoft' else .0045))
        x = crack * (.59 if kind == 'hitSoft' else .45)
        for freq, gain, decay in modes:
            x += np.sin(2 * np.pi * freq * pitch * t) * np.exp(-t / decay) * gain
        # Broadband hollow board body keeps this a wooden knock, not a pitched oscillator beep.
        x += filtered_noise(len(t), rng, 100 if kind == 'hitHard' else 260, 2700) * np.exp(-t / .022) * .26
        if kind == 'hitHard':
            x += filtered_noise(len(t), rng, 50, 260) * np.exp(-t / .062) * .31
    attack = np.minimum(1, t / .0025)
    tail = np.minimum(1, (length - t) / .012)
    return x * attack * tail

def add_at(target, source, seconds, gain=1):
    start = round(seconds * SR)
    end = min(len(target), start + len(source))
    target[start:end] += source[:end - start] * gain

def render(kind, variant):
    if kind in ['hitSoft', 'hitMedium', 'hitHard', 'hinge', 'flick']:
        return impact(kind, variant)
    if kind == 'fall':
        x = np.zeros(round(.52 * SR))
        add_at(x, impact('hitHard', variant), 0, .70)
        add_at(x, impact('hitMedium', variant + 1), .125 + variant * .009, .37)
        add_at(x, impact('hitSoft', variant + 2), .265 + variant * .005, .17)
        return x
    if kind == 'win':
        x = np.zeros(round(.44 * SR))
        add_at(x, impact('hitMedium', variant), 0, .55)
        add_at(x, impact('hitSoft', variant + 1), .115, .31)
        return x
    raise ValueError(kind)

def write_wav(path, samples, peak=PEAK):
    samples = samples / max(np.max(np.abs(samples)), 1e-12) * peak
    pcm = np.rint(samples * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR); f.writeframes(pcm.tobytes())
    significant = np.flatnonzero(np.abs(samples) > 10 ** (-45 / 20))
    spectrum = np.abs(np.fft.rfft(samples))
    freqs = np.fft.rfftfreq(len(samples), 1 / SR)
    return {
        'file': path.name, 'seconds': round(len(samples) / SR, 4),
        'peakDbFS': round(float(20 * np.log10(np.max(np.abs(samples)))), 2),
        'rmsDbFS': round(float(20 * np.log10(np.sqrt(np.mean(samples ** 2)))), 2),
        'leadingMsAtMinus45dB': round(float(significant[0] / SR * 1000), 3) if len(significant) else None,
        'clippedSamples': int(np.sum(np.abs(pcm.astype(np.int32)) >= 32767)),
        'spectralCentroidHz': round(float((freqs * spectrum).sum() / spectrum.sum())),
    }, samples

def main():
    manifest = {'version': 1, 'clips': {}}
    report, rendered = [], {}
    for kind in ['flick', 'hitSoft', 'hitMedium', 'hitHard', 'hinge', 'fall', 'win']:
        manifest['clips'][kind] = []
        for i in range(3):
            filename = f'{kind}-{i + 1:02}.wav'
            stats, samples = write_wav(ROOT / filename, render(kind, i))
            manifest['clips'][kind].append('/audio/' + filename); report.append(stats); rendered[(kind, i)] = samples
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    audition = np.zeros(round(7.5 * SR))
    order = []
    for n, kind in enumerate(['flick', 'hitSoft', 'hitMedium', 'hitHard', 'hinge', 'fall', 'win']):
        when = .2 + n * 1.02
        add_at(audition, rendered[(kind, 1)], when, .78)
        order.append({'atSeconds': round(when, 2), 'sound': kind})
    write_wav(REPORT_ROOT / 'audition.wav', audition, peak=10 ** (-5 / 20))
    (REPORT_ROOT / 'sound-analysis.json').write_text(json.dumps({'sampleRate': SR, 'format': 'PCM16 mono', 'clips': report, 'auditionOrder': order}, indent=2) + '\n')
    assert all(s['clippedSamples'] == 0 and s['leadingMsAtMinus45dB'] < 5 for s in report)
    print(json.dumps({'files': len(report), 'sampleRate': SR, 'clipCount': sum(s['clippedSamples'] for s in report), 'maximumLeadingMs': max(s['leadingMsAtMinus45dB'] for s in report), 'bytes': sum(p.stat().st_size for p in ROOT.glob('*.wav'))}))

if __name__ == '__main__': main()
