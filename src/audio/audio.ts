import { pieceSpec } from '../core/rules.ts';
import type { GameEvent, MatchState } from '../core/types.ts';

type SoundName = 'flick' | 'hitSoft' | 'hitMedium' | 'hitHard' | 'hinge' | 'fall' | 'win';
interface AudioManifest { version: 1; clips: Record<SoundName, string[]> }
interface Voice { source: AudioBufferSourceNode; priority: number; started: number; name: SoundName; strength: number }
const SOUND_NAMES: SoundName[] = ['flick', 'hitSoft', 'hitMedium', 'hitHard', 'hinge', 'fall', 'win'];

/** Authored WAV Foley, decoded ahead of impacts. Audio never changes game state. */
export class AudioPlayer {
  private audible = false;
  get enabled(): boolean { return this.audible; }
  set enabled(value: boolean) { this.audible = value; if (!value) this.reset(); }
  private context?: AudioContext;
  private bus?: GainNode;
  private clips: Partial<Record<SoundName, AudioBuffer[]>> = {};
  private lastSound = new Map<SoundName, number>();
  private cursor = 0;
  private poweredStone: number | null = null;
  private loading?: Promise<void>;
  private voices = new Set<Voice>();
  private prepared = this.prepare();

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.bus = this.context.createGain(); this.bus.gain.value = .8;
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -12; compressor.knee.value = 6; compressor.ratio.value = 7;
      compressor.attack.value = .002; compressor.release.value = .065;
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
    if (e.kind === 'turn-ended') this.poweredStone = null;
    if (e.kind === 'hit') {
      const powered = e.a === this.poweredStone || e.b === this.poweredStone;
      if (powered) this.poweredStone = null;
      const a = state?.stones.find(s => s.id === e.a), b = state?.stones.find(s => s.id === e.b);
      const mass = Math.max(pieceSpec(a?.kind).mass, pieceSpec(b?.kind).mass);
      const sample: SoundName = mass >= 1.8 ? 'hitHard' : mass >= 1.1 ? 'hitMedium' : 'hitSoft';
      this.play(sample, e.strength, 1 + e.strength + (powered ? .4 : 0), 0, powered ? .84 : 1, powered ? 1.18 : 1);
    } else if (e.kind === 'hinge-hit') {
      const powered = e.stoneId === this.poweredStone;
      if (powered) this.poweredStone = null;
      this.play('hinge', e.strength, 2 + e.strength, 0, powered ? .9 : 1, powered ? 1.12 : 1);
    } else if (e.kind === 'removed') {
      if (e.stoneId === this.poweredStone) this.poweredStone = null;
      // The piece clears the edge first; its landing follows the visible drop.
      this.play('fall', .7, 3, .09);
    } else if (e.kind === 'shot') {
      this.poweredStone = e.skill === 'power' ? e.stoneId : null;
      this.play('flick', e.power, .5 + e.power * .3, 0, e.skill === 'power' ? .88 : 1, e.skill === 'power' ? 1.25 : 1);
    }
    else if (e.kind === 'match-ended') this.play('win', .5, 4, .48);
  }

  private play(name: SoundName, strength: number, priority: number, delay = 0, pitch = 1, level = 1): void {
    const ctx = this.context!, samples = this.clips[name];
    if (!samples?.length || !this.bus) return;
    const now = ctx.currentTime;
    const gap = name === 'fall' ? .075 : name === 'hinge' ? .045 : .035;
    if (now - (this.lastSound.get(name) ?? -Infinity) < gap) {
      // A strong contact must survive a soft contact earlier in the same frame.
      const recent = [...this.voices].filter(v => v.name === name && now - v.started < gap);
      if (!recent.length || recent.some(v => v.strength >= strength)) return;
      for (const voice of recent) { voice.source.stop(); this.voices.delete(voice); }
    }
    if (this.voices.size >= 7) {
      const least = [...this.voices].sort((a, b) => a.priority - b.priority || a.started - b.started)[0];
      if (least.priority > priority) return;
      least.source.stop(); this.voices.delete(least);
    }
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    const index = this.cursor++;
    source.buffer = samples[index % samples.length]; source.playbackRate.value = (.995 + index % 4 * .01) * pitch;
    const mix: Record<SoundName, number> = { flick: .15, hitSoft: .36, hitMedium: .39, hitHard: .40, hinge: .31, fall: .38, win: .22 };
    gain.gain.value = mix[name] * level * (.28 + Math.max(0, Math.min(1, strength)) * .72);
    source.connect(gain).connect(this.bus);
    const voice = { source, priority, started: now, name, strength }; this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); gain.disconnect(); };
    this.lastSound.set(name, now); source.start(now + delay);
  }

  /** Cancel current and scheduled sounds when leaving or restarting a match. */
  reset(): void {
    for (const voice of this.voices) voice.source.stop();
    this.voices.clear(); this.lastSound.clear(); this.poweredStone = null;
  }

  suspend(): void { this.reset(); void this.context?.suspend(); }
}
