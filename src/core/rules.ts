import type { PieceKind, StoneSeed } from './types.ts';
export interface PieceSpec { name: string; label: readonly [string, string]; radius: number; mass: number; maxSpeed: number }
/** Relative game weights, not measured weights of real janggi pieces. */
export const PIECES: Readonly<Record<PieceKind, PieceSpec>> = Object.freeze({
  king: { name: '왕', label: ['楚', '漢'], radius: .45, mass: 2.8, maxSpeed: 9.8 },
  chariot: { name: '차', label: ['車', '車'], radius: .39, mass: 2, maxSpeed: 10.2 },
  cannon: { name: '포', label: ['包', '包'], radius: .37, mass: 1.8, maxSpeed: 10.5 },
  elephant: { name: '상', label: ['象', '象'], radius: .34, mass: 1.4, maxSpeed: 11 },
  horse: { name: '마', label: ['馬', '馬'], radius: .33, mass: 1.3, maxSpeed: 11.3 },
  guard: { name: '사', label: ['士', '士'], radius: .27, mass: .9, maxSpeed: 11.6 },
  soldier: { name: '졸', label: ['兵', '卒'], radius: .24, mass: .65, maxSpeed: 12 },
});
export function pieceSpec(kind?: PieceKind): PieceSpec { return PIECES[kind ?? 'horse']; }
export function maxImpulseFor(kind?: PieceKind): number { const p = pieceSpec(kind); return Math.floor(p.mass * p.maxSpeed * 1000); }
export const RULES = Object.freeze({
  version: 'janggi-alkkagi-4', engine: 'rapier2d-0.21.0',
  width: 9, height: 10, radius: .33, hz: 120, dt: 1 / 120,
  maxImpulse: 27440, minImpulse: 200, impulseScale: 1000,
  // A fresh flick keeps its punch; braking builds with slide age and distance.
  damping: .12, slidingFriction: .65, brakingFriction: 11,
  launchGrace: .15, brakingRamp: .25, distanceBrake: 1.5, slowSpeed: 4,
  lowSpeedBrake: 8, restitution: .78, restSpeed: .08, quietTicks: 24,
  maxShotTicks: 1440, maxTurns: 200,
});
/** Short raised hinges only; the middle of the folding seam stays traversable. */
export const HINGES = Object.freeze([
  { id: 'left', x: 1.8, y: 5, halfWidth: .65, halfHeight: .23 },
  { id: 'right', x: 6.9, y: 5, halfWidth: .65, halfHeight: .23 },
] as const);
const rows: Array<{ kind: PieceKind; file: number; rank: number }> = [
  { kind: 'chariot', file: 0, rank: 0 }, { kind: 'horse', file: 1, rank: 0 },
  { kind: 'elephant', file: 2, rank: 0 }, { kind: 'guard', file: 3, rank: 0 },
  { kind: 'guard', file: 5, rank: 0 }, { kind: 'elephant', file: 6, rank: 0 },
  { kind: 'horse', file: 7, rank: 0 }, { kind: 'chariot', file: 8, rank: 0 },
  { kind: 'king', file: 4, rank: 1 },
  { kind: 'cannon', file: 1, rank: 2 }, { kind: 'cannon', file: 7, rank: 2 },
  ...[0, 2, 4, 6, 8].map(file => ({ kind: 'soldier' as const, file, rank: 3 })),
];
export const INITIAL_STONES: readonly StoneSeed[] = ([0, 1] as const).flatMap(side => rows.map((p, i) => ({
  id: side * 16 + i, side, kind: p.kind, x: .5 + p.file,
  y: side === 1 ? .5 + p.rank : 9.5 - p.rank,
})));
