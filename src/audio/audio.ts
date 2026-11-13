import type { GameEvent } from '../core/types.ts';
type SoundName = 'flick' | 'hitSoft' | 'hitHard' | 'fall' | 'win';
interface AudioManifest { version: 1; clips: Record<SoundName, string[]> }
export class AudioPlayer {
  enabled = false;
  private context?: AudioContext;
  private clips: Partial<Record<SoundName, AudioBuffer[]>> = {};
  private lastSound = -Infinity;
  private cursor = 0;
  private loading?: Promise<void>;
  async unlock(): Promise<void> {
    this.context ??= new AudioContext(); await this.context.resume();
    this.loading ??= this.load();
  }
  private async load(): Promise<void> {
    try {
      const data = await fetch('/audio/manifest.json').then(r => r.json()) as AudioManifest;
      if (data.version !== 1) return;
      for (const [kind, paths] of Object.entries(data.clips)) {
        this.clips[kind as SoundName] = await Promise.all(paths.map(async path => {
          const bytes = await fetch(path).then(r => { if (!r.ok) throw Error(path); return r.arrayBuffer(); });
          return this.context!.decodeAudioData(bytes);
        }));
      }
    } catch { /* Prepared files are optional; the clearly marked temporary synth stays available. */ }
  }
  event(e: GameEvent): void {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    if (e.kind === 'hit') this.play(e.strength > .5 ? 'hitHard' : 'hitSoft', e.strength);
    else if (e.kind === 'removed') this.play('fall', .7);
    else if (e.kind === 'shot') this.play('flick', .45);
    else if (e.kind === 'match-ended') this.play('win', .45);
  }
  private play(name: SoundName, strength: number): void {
    const ctx = this.context!, now = ctx.currentTime;
    if (name !== 'fall' && now - this.lastSound < .025) return;
    this.lastSound = now;
    const samples = this.clips[name];
    if (samples?.length) {
      const source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = samples[this.cursor++ % samples.length]; source.playbackRate.value = .98 + (this.cursor % 5) * .01;
      gain.gain.value = .18 + strength * .45; source.connect(gain).connect(ctx.destination); source.start(); return;
    }
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = name === 'fall' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(name === 'fall' ? 160 : name === 'flick' ? 420 : 1400, now);
    oscillator.frequency.exponentialRampToValueAtTime(name === 'fall' ? 45 : 100, now + .06);
    gain.gain.setValueAtTime(.035 + strength * .18, now); gain.gain.exponentialRampToValueAtTime(.001, now + .12);
    oscillator.connect(gain).connect(ctx.destination); oscillator.start(); oscillator.stop(now + .13);
    if (name.startsWith('hit')) {
      const length = Math.floor(ctx.sampleRate * .03), buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * .13));
      const source = ctx.createBufferSource(), v = ctx.createGain(); source.buffer = buffer; v.gain.value = strength * .13;
      source.connect(v).connect(ctx.destination); source.start();
    }
  }
  suspend(): void { void this.context?.suspend(); }
}
