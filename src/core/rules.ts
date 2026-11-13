import type { StoneSeed } from './types.ts';
export const RULES = Object.freeze({
  version: 'alkkagi-1', engine: 'rapier2d-0.21.0',
  width: 8, height: 5.2, radius: .28, hz: 120, dt: 1 / 120,
  maxImpulse: 12000, minImpulse: 200, impulseScale: 1000,
  damping: 1.15, restitution: .94, restSpeed: .035, quietTicks: 30,
  maxShotTicks: 1200, maxTurns: 120,
});
export const INITIAL_STONES: readonly StoneSeed[] = [
  { id: 0, side: 0, x: 1.15, y: 1.05 },
  { id: 1, side: 0, x: 1.15, y: 2.6 },
  { id: 2, side: 0, x: 1.15, y: 4.15 },
  { id: 3, side: 1, x: 6.85, y: 1.05 },
  { id: 4, side: 1, x: 6.85, y: 2.6 },
  { id: 5, side: 1, x: 6.85, y: 4.15 },
];
