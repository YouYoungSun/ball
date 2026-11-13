import { pieceSpec } from '../core/rules.ts';
import type { GameEvent, MatchState } from '../core/types.ts';

type SoundName = 'flick' | 'hitSoft' | 'hitMedium' | 'hitHard' | 'hinge' | 'fall' | 'win';
interface AudioManifest { version: 1; clips: Record<SoundName, string[]> }
interface Voice { source: AudioBufferSourceNode; priority: number; started: number }
const SOUND_NAMES: SoundName[] = ['flick', 'hitSoft', 'hitMedium', 'hitHard', 'hinge', 'fall', 'win'];

/** Authored WAV Foley, decoded ahead of impacts. Audio never changes game state. */
export class AudioPlayer {
  enabled = false;
  private context?: AudioContext;
  private bus?: GainNode;
  private clips: Partial<Record<SoundName, AudioBuffer[]>> = {};
  private lastSound = new Map<SoundName, number>();
  private cursor = 0;
  private loading?: Promise<void>;
  private voices = new Set<Voice>();
  private prepared = this.prepare();

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.bus = this.context.createGain(); this.bus.gain.value = .8;
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -12; compressor.knee.value = 6; compressor.ratio.value = 7;
      compressor.attack.value = .002; compressor.release.value = .09;
      this.bus.connect(compressor).connect(this.context.destination);
    }
    await this.context.resume();
    this.loading ??= this.load();
    await this.loading;
  }

  private async prepare(): Promise<Partial<Record<SoundName, ArrayBuffer[]>>> {
    try {
      const response = await fetch('/audio/manifest.json');
      if (!response.ok) return {};
      const data = await response.json() as AudioManifest;
      if (data.version !== 1 || !data.clips) return {};
      const result: Partial<Record<SoundName, ArrayBuffer[]>> = {};
      await Promise.all(SOUND_NAMES.map(async kind => {
        const buffers = await Promise.all((data.clips[kind] ?? []).map(async path => {
          try {
            const response = await fetch(path);
            if (!response.ok) return null;
            return await response.arrayBuffer();
          } catch { return null; }
        }));
        result[kind] = buffers.filter((buffer): buffer is ArrayBuffer => buffer !== null);
      }));
      return result;
    } catch { return {}; }
  }

  private async load(): Promise<void> {
    const files = await this.prepared;
    await Promise.all(SOUND_NAMES.map(async kind => {
      const decoded = await Promise.all((files[kind] ?? []).map(async bytes => {
        try { return await this.context!.decodeAudioData(bytes); } catch { return null; }
      }));
      this.clips[kind] = decoded.filter((clip): clip is AudioBuffer => clip !== null);
    }));
  }

  event(e: GameEvent, state?: MatchState): void {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    if (e.kind === 'hit') {
      const a = state?.stones.find(s => s.id === e.a), b = state?.stones.find(s => s.id === e.b);
      const mass = Math.max(pieceSpec(a?.kind).mass, pieceSpec(b?.kind).mass);
      const sample: SoundName = mass >= 1.8 ? 'hitHard' : mass >= 1.1 ? 'hitMedium' : 'hitSoft';
      this.play(sample, e.strength, 1 + e.strength);
    } else if (e.kind === 'hinge-hit') this.play('hinge', e.strength, 2 + e.strength);
    else if (e.kind === 'removed') this.play('fall', .7, 3);
    else if (e.kind === 'shot') this.play('flick', .4, .5);
    else if (e.kind === 'match-ended') this.play('win', .5, 4);
  }

  private play(name: SoundName, strength: number, priority: number): void {
    const ctx = this.context!, samples = this.clips[name];
    if (!samples?.length || !this.bus) return;
    const now = ctx.currentTime;
    const gap = name === 'fall' ? .075 : name === 'hinge' ? .045 : .035;
    if (now - (this.lastSound.get(name) ?? -Infinity) < gap) return;
    if (this.voices.size >= 7) {
      const least = [...this.voices].sort((a, b) => a.priority - b.priority || a.started - b.started)[0];
      if (least.priority > priority) return;
      least.source.stop(); this.voices.delete(least);
    }
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    const index = this.cursor++;
    source.buffer = samples[index % samples.length]; source.playbackRate.value = .985 + index % 4 * .01;
    const mix: Record<SoundName, number> = { flick: .15, hitSoft: .32, hitMedium: .38, hitHard: .44, hinge: .32, fall: .35, win: .23 };
    gain.gain.value = mix[name] * (.28 + Math.max(0, Math.min(1, strength)) * .72);
    source.connect(gain).connect(this.bus);
    const voice = { source, priority, started: now }; this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); gain.disconnect(); };
    this.lastSound.set(name, now); source.start();
  }

  suspend(): void { void this.context?.suspend(); }
}
