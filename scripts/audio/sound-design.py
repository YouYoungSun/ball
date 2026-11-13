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
    length = {'hitSoft': .075, 'hitMedium': .11, 'hitHard': .145, 'hinge': .16, 'flick': .08}[kind]
    t = np.arange(round(length * SR)) / SR
    pitch = 1 + (variation - 1) * .035
    if kind == 'flick':
        x = filtered_noise(len(t), rng, 1100, 13000) * np.exp(-t / .015) * .28
        # A finger's brief grainy slide, then a tiny release click.
        x += filtered_noise(len(t), rng, 1300, 5200) * np.exp(-((t - .010) / .008) ** 2) * .19
        x += np.sin(2 * np.pi * 1560 * t) * np.exp(-t / .005) * .035
    elif kind == 'hinge':
        x = filtered_noise(len(t), rng, 1300, 16000) * np.exp(-t / .004) * .48
        for freq, gain, decay in [(2300, .18, .020), (3850, .10, .014), (6100, .055, .009), (8500, .025, .006)]:
            x += np.sin(2 * np.pi * freq * pitch * t) * np.exp(-t / decay) * gain
        x += filtered_noise(len(t), rng, 400, 1800) * np.exp(-t / .012) * .16
    else:
        modes = {
            'hitSoft': [(980, .21, .006), (2100, .16, .0048), (4000, .08, .0035)],
            'hitMedium': [(440, .19, .014), (960, .24, .011), (2050, .15, .006), (3700, .08, .004)],
            'hitHard': [(190, .18, .019), (520, .26, .017), (1150, .22, .010), (2400, .12, .006), (4100, .06, .0035)],
        }[kind]
        crack = filtered_noise(len(t), rng, 1900, 16000) * np.exp(-t / (.0035 if kind == 'hitSoft' else .0039))
        x = crack * (.60 if kind == 'hitSoft' else .51)
        for freq, gain, decay in modes:
            x += np.sin(2 * np.pi * freq * pitch * t) * np.exp(-t / decay) * gain
        # Broadband hollow board body keeps this a wooden knock, not a pitched oscillator beep.
        x += filtered_noise(len(t), rng, 300, 4000) * np.exp(-t / .012) * .22
        if kind == 'hitHard':
            x += filtered_noise(len(t), rng, 140, 500) * np.exp(-t / .022) * .08
    attack = np.minimum(1, t / .002)
    tail = np.minimum(1, (length - t) / .008)
    return x * attack * tail

def add_at(target, source, seconds, gain=1):
    start = round(seconds * SR)
    end = min(len(target), start + len(source))
    target[start:end] += source[:end - start] * gain

def render(kind, variant):
    if kind in ['hitSoft', 'hitMedium', 'hitHard', 'hinge', 'flick']:
        return impact(kind, variant)
    if kind == 'fall':
        x = np.zeros(round(.36 * SR))
        add_at(x, impact('hitMedium', variant), 0, .55)
        add_at(x, impact('hitSoft', variant + 1), .095 + variant * .005, .30)
        add_at(x, impact('hitSoft', variant + 2), .195 + variant * .004, .13)
        return x
    if kind == 'win':
        x = np.zeros(round(.28 * SR))
        add_at(x, impact('hitMedium', variant), 0, .45)
        add_at(x, impact('hitSoft', variant + 1), .085, .30)
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
        'attack35msRmsDbFS': round(float(20 * np.log10(max(1e-12, np.sqrt(np.mean(samples[:round(.035 * SR)] ** 2))))), 2),
        'leadingMsAtMinus45dB': round(float(significant[0] / SR * 1000), 3) if len(significant) else None,
        'clippedSamples': int(np.sum(np.abs(pcm.astype(np.int32)) >= 32767)),
        'spectralCentroidHz': round(float((freqs * spectrum).sum() / spectrum.sum())),
        'energyBelow300HzPercent': round(float((spectrum[freqs < 300] ** 2).sum() / (spectrum ** 2).sum() * 100), 2),
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
    (REPORT_ROOT / 'sound-analysis.json').write_text(json.dumps({'revision': 'v0.3-bright', 'sampleRate': SR, 'format': 'PCM16 mono', 'clips': report, 'auditionOrder': order}, indent=2) + '\n')
    assert all(s['clippedSamples'] == 0 and s['leadingMsAtMinus45dB'] < 5 for s in report)
    print(json.dumps({'files': len(report), 'sampleRate': SR, 'clipCount': sum(s['clippedSamples'] for s in report), 'maximumLeadingMs': max(s['leadingMsAtMinus45dB'] for s in report), 'bytes': sum(p.stat().st_size for p in ROOT.glob('*.wav'))}))

if __name__ == '__main__': main()
