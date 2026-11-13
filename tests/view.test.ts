import test from 'node:test';
import assert from 'node:assert/strict';
import { TableView, TABLE } from '../src/view/table.ts';
import type { MatchState } from '../src/core/types.ts';

// Canvas routing harness: checks event lifetime, not browser paint or appearance.
const gradient = { addColorStop() {} };
const context = new Proxy({} as CanvasRenderingContext2D, {
  get(_target, key) {
    if (key === 'createLinearGradient') return () => gradient;
    if (key === 'measureText') return () => ({ width: 50 });
    return () => {};
  }, set() { return true; },
});
const canvas = () => ({ width: TABLE.width, height: TABLE.height, getContext: () => context });
(globalThis as any).document = { createElement: canvas };
const state = (): MatchState => ({ matchId: 'view', tick: 0, turn: 0, side: 0, phase: 'moving', winner: null, skillUsed: [true, false], stones: [
  { id: 0, side: 0, kind: 'soldier', x: 4, y: 6, vx: 0, vy: -7, alive: true },
  { id: 1, side: 1, kind: 'soldier', x: 4, y: 5, vx: 0, vy: 0, alive: true },
] });
const shot = { kind: 'shot', tick: 0, stoneId: 0, power: .8, skill: 'power', directionX: 0, directionY: -1 } as const;
const hit = { kind: 'hit', tick: 1, a: 0, b: 1, x: 4, y: 5.5, strength: .8 } as const;
const view = () => new TableView(canvas() as unknown as HTMLCanvasElement);

test('power visual follows only its stone until its first contact', () => {
  const v = view(), s = state(), original = structuredClone(s);
  v.receive([shot], s);
  assert.equal((v as any).poweredStone, 0);
  v.receive([{ ...hit, a: 2, b: 3 }], s);
  assert.equal((v as any).poweredStone, 0);
  assert.equal((v as any).flashes.at(-1).powered, false);
  v.receive([hit], s);
  assert.equal((v as any).poweredStone, null);
  assert.equal((v as any).flashes.at(-1).powered, true);
  v.receive([{ ...hit, tick: 2 }], s);
  assert.equal((v as any).flashes.at(-1).powered, false);
  v.render(s, .02, null, null);
  assert.deepEqual(s, original, 'presentation does not mutate authoritative state');
});

test('removal, turn end and clear retire power presentation', () => {
  const v = view(), s = state();
  for (const event of [
    { kind: 'removed', tick: 1, stoneId: 0, side: 0, x: 4, y: 0, vx: 0, vy: -5 },
    { kind: 'turn-ended', tick: 1, turn: 1, side: 1 },
  ] as const) {
    v.receive([shot, event], s); assert.equal((v as any).poweredStone, null);
  }
  v.receive([shot], s); v.clear();
  assert.equal((v as any).poweredStone, null);
  assert.equal((v as any).powerStrokes.length, 0);
});

test('old batched impacts expire instead of appearing freshly on replay', () => {
  const v = view(), s = state();
  v.receive([shot, hit, { kind: 'turn-ended', tick: 120, turn: 1, side: 1 }], s);
  v.render(s, 0, null, null);
  assert.equal((v as any).flashes.length, 0);
  assert.equal((v as any).powerStrokes.length, 0);
});
