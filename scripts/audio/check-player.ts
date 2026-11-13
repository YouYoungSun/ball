/** Headless integration smoke check; does not claim browser playback or listening QA. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AudioPlayer } from '../../src/audio/audio.ts';
import type { GameEvent, MatchState } from '../../src/core/types.ts';

const folder = new URL('../../public/', import.meta.url);
const started: Array<{ duration: number; stopped: boolean }> = [];
let decoded = 0, now = 0;
const parameter = () => ({ value: 0 });
const node = () => ({ connect(next: unknown) { return next; }, disconnect() {} });
class MockContext {
  state = 'running'; destination = {};
  get currentTime() { return now; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  createGain() { return { ...node(), gain: parameter() }; }
  createDynamicsCompressor() { return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() }; }
  async decodeAudioData(bytes: ArrayBuffer) {
    decoded++; const data = new DataView(bytes); return { duration: (data.byteLength - 44) / (data.getUint32(24, true) * 2) };
  }
  createBufferSource() {
    const record = { duration: 0, stopped: false };
    return { ...node(), buffer: null as null | { duration: number }, playbackRate: parameter(), onended: null as null | (() => void),
      start() { record.duration = this.buffer!.duration; started.push(record); }, stop() { record.stopped = true; this.onended?.(); } };
  }
}
(globalThis as any).AudioContext = MockContext;
(globalThis as any).fetch = async (url: string) => {
  const path = fileURLToPath(new URL(url.replace(/^\//, ''), folder));
  const bytes = await readFile(path);
  return new Response(bytes, { status: 200, headers: { 'Content-Type': url.endsWith('.json') ? 'application/json' : 'audio/wav' } });
};
const player = new AudioPlayer(); player.enabled = true; await player.unlock();
assert.equal(decoded, 21);
function send(e: GameEvent, kinds: ['soldier' | 'horse' | 'king', 'soldier' | 'horse' | 'king'] = ['soldier', 'soldier']) {
  now += .2;
  player.event(e, { stones: [{ id: 0, kind: kinds[0] }, { id: 1, kind: kinds[1] }] } as MatchState);
}
send({ kind: 'hit', tick: 1, a: 0, b: 1, x: 0, y: 0, strength: .6 }); assert.equal(started.at(-1)!.duration, .075);
send({ kind: 'hit', tick: 2, a: 0, b: 1, x: 0, y: 0, strength: .6 }, ['horse', 'soldier']); assert.equal(started.at(-1)!.duration, .085);
send({ kind: 'hit', tick: 3, a: 0, b: 1, x: 0, y: 0, strength: .6 }, ['king', 'soldier']); assert.equal(started.at(-1)!.duration, .095);
const beforeKingPair = started.length;
send({ kind: 'hit', tick: 3, a: 0, b: 1, x: 0, y: 0, strength: .8 }, ['king', 'king']);
assert.equal(started.length, beforeKingPair + 1, 'one collision selects one sample, including two kings');
assert.equal(started.at(-1)!.duration, .095);
send({ kind: 'hinge-hit', tick: 4, stoneId: 0, hingeId: 'left', x: 0, y: 0, strength: .6 }); assert.equal(started.at(-1)!.duration, .16);
send({ kind: 'shot', tick: 5, stoneId: 0 }); assert.equal(started.at(-1)!.duration, .08);
send({ kind: 'removed', tick: 6, stoneId: 0, side: 0, x: 0, y: 0, vx: 0, vy: 0 }); assert.equal(started.at(-1)!.duration, .36);
send({ kind: 'match-ended', tick: 7, winner: 0 }); assert.equal(started.at(-1)!.duration, .28);
send({ kind: 'hinge-hit', tick: 8, stoneId: 0, hingeId: 'left', x: 0, y: 0, strength: .6 });
assert.ok(started.some(s => s.stopped));
assert.ok(started.filter(s => !s.stopped).length <= 7);
const previous = started.length; player.enabled = false;
send({ kind: 'shot', tick: 9, stoneId: 0 }); assert.equal(started.length, previous);
console.log('Audio smoke: 21 decoded assets, 7 event/material routes, voice cap, mute all passed.');
