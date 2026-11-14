import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initPhysics } from '../src/core/game.ts';
import { TABLE } from '../src/view/table.ts';
import { recordScenario, scenarios } from '../src/lab/scenarios.ts';
import * as a from '../src/candidates/a/index.ts';
import * as b from '../src/candidates/b/index.ts';
import * as c from '../src/candidates/c/index.ts';

// This harness checks routing and lifetime; it cannot verify browser paint or listening.
const gradient = { addColorStop() {} };
const context = new Proxy({} as CanvasRenderingContext2D, {
  get(_target, key) {
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
    if (key === 'measureText') return () => ({ width: 50 });
    return () => {};
  }, set() { return true; },
});
const canvas = () => ({ width: TABLE.width, height: TABLE.height, getContext: () => context,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: TABLE.width, height: TABLE.height }) });
(globalThis as any).document = { createElement: canvas };
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
before(async () => { await initPhysics(); });
const entries = [['A', a], ['B', b], ['C', c]] as const;
for (const [label, candidate] of entries) {
  test(`${label}: complete immutable core recordings render in both motion modes`, () => {
    for (const effects of [true, false]) for (const power of [false, true]) {
      const recording = freeze(recordScenario(scenarios[0], power));
      const view = candidate.createView(canvas() as unknown as HTMLCanvasElement);
      view.effects = effects; view.shaking = false;
      view.setPreparation(0, .9, power);
      view.render(recording.initial, 0, 0, freeze({ stoneId: 0, x: 4.5, y: 8 }));
      let previous = recording.initial;
      for (const frame of recording.frames) {
        view.receive(frame.events, previous);
        view.render(frame.state, 1 / 120, null, null, previous, .5);
        view.render(frame.state, 0, null, null, previous, .5);
        previous = frame.state;
      }
      assert.equal(recording.signature, JSON.stringify(recording.frames));
      view.clear();
      view.render(recording.initial, 0, null, null);
    }
  });

  test(`${label}: old batched events expire and clear resets preparation and power`, () => {
    const view = candidate.createView(canvas() as unknown as HTMLCanvasElement) as any;
    const recording = recordScenario(scenarios[0], true);
    const events = freeze([...recording.frames.flatMap(frame => frame.events), {kind:'turn-ended',tick:1000,turn:2,side:1} as const]);
    view.receive(events, freeze(recording.initial));
    view.render(recording.frames.at(-1)!.state, 0, null, null);
    for (const key of ['cues', 'reactions', 'contacts', 'falling', 'releases', 'traces', 'marks', 'drops']) {
      if (Array.isArray(view[key])) assert.equal(view[key].length, 0, `${key} expired`);
    }
    assert.equal(view.hold ?? null, null);
    view.setPreparation(0, 1, true); view.receive([recording.frames[0].events[0]], recording.initial);
    view.clear();
    assert.equal(view.powered, null);
    assert.equal((view.prep ?? view.preparation).id, null);
    for (const key of ['cues', 'reactions', 'contacts', 'falling', 'releases', 'traces', 'marks', 'drops']) {
      if (Array.isArray(view[key])) assert.equal(view[key].length, 0, `${key} cleared`);
    }
  });

  test(`${label}: motion-off discards pending inherited fall animation`, () => {
    const view = candidate.createView(canvas() as unknown as HTMLCanvasElement) as any;
    const recording = recordScenario(scenarios[0], true);
    const fallFrame = recording.frames.find(frame => frame.events.some(event => event.kind === 'removed'))!;
    view.receive(fallFrame.events, recording.initial);
    view.effects = false;
    view.render(fallFrame.state, 0, null, null);
    const base = view.base ?? view.board;
    assert.equal(base.falls.length, 0, 'motion-off removes an already queued inherited fall');
    view.receive(fallFrame.events, recording.initial);
    view.render(fallFrame.state, 0, null, null);
    assert.equal(base.falls.length, 0, 'motion-off does not queue new inherited falls');
  });
}

const scheduled: Array<{ started: boolean; canceled: boolean; when: number }> = [];
const parameter = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
const node = () => ({ connect(next: unknown) { return next; }, disconnect() {} });
class MockAudioContext {
  state = 'running'; currentTime = 0; sampleRate = 8000; destination = {};
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  createGain() { return { ...node(), gain: parameter() }; }
  createDynamicsCompressor() { return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() }; }
  createBiquadFilter() { return { ...node(), type: '', frequency: parameter(), Q: parameter() }; }
  createBuffer(_channels: number, length: number) { const values = new Float32Array(length); return { getChannelData: () => values }; }
  private source() {
    const record = { started: false, canceled: false, when: 0 }; scheduled.push(record);
    return { ...node(), buffer: null, type: '', frequency: parameter(), playbackRate: parameter(), onended: null as null | (() => void),
      start(when = 0) { record.started = true; record.when = when; },
      stop(when?: number) { if (when === undefined) { record.canceled = true; this.onended?.(); } },
    };
  }
  createBufferSource() { return this.source(); }
  createOscillator() { return this.source(); }
}
(globalThis as any).AudioContext = MockAudioContext;
for (const [label, candidate] of entries) {
  test(`${label}: synthesized audio reset, mute, suspend cancel current and delayed sources`, async () => {
    const audio = candidate.createAudio(); await audio.unlock(); audio.enabled = true;
    const recording = freeze(recordScenario(scenarios[0], true));
    const shot = recording.frames[0].events[0];
    const fall = recording.frames.flatMap(frame => frame.events).find(event => event.kind === 'removed')!;
    const end = recording.frames.flatMap(frame => frame.events).find(event => event.kind === 'match-ended')!;
    for (const action of ['reset', 'mute', 'suspend']) {
      audio.enabled = true; await audio.unlock();
      const first = scheduled.length;
      for (const event of [shot, fall, end]) audio.event(event, recording.initial);
      const voices = scheduled.slice(first);
      assert.ok(voices.some(voice => voice.started));
      assert.ok(voices.some(voice => voice.when > 0), 'fall or result schedules a delayed sound');
      if (action === 'reset') audio.reset();
      else if (action === 'mute') audio.enabled = false;
      else audio.suspend();
      assert.ok(voices.every(voice => voice.canceled), `${action} cancels all sources`);
    }
    audio.enabled = false;
    const count = scheduled.length;
    for (const event of [shot, fall, end]) audio.event(event, recording.initial);
    assert.equal(scheduled.length, count, 'muted events create no new sources');
  });
}
