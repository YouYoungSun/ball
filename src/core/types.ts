export type Side = 0 | 1;
export type Phase = 'aiming' | 'moving' | 'finished';
export type PieceKind = 'king' | 'guard' | 'chariot' | 'cannon' | 'horse' | 'elephant' | 'soldier';
export interface StoneSeed { id: number; side: Side; x: number; y: number; kind?: PieceKind }
export interface StoneState extends StoneSeed { alive: boolean; vx: number; vy: number }
export interface MatchState {
  matchId: string; tick: number; turn: number; side: Side; phase: Phase;
  winner: Side | 'draw' | null; skillUsed: [boolean, boolean]; stones: StoneState[];
}
export interface ShotCommand {
  kind: 'shoot'; matchId: string; rulesVersion: string; turn: number;
  shotId: string; side: Side; stoneId: number; impulseX: number; impulseY: number; skill?: 'power';
}
export type ShotResult = { accepted: true } | { accepted: false; reason: string };
export type GameEvent =
  | { kind: 'shot'; tick: number; stoneId: number; power: number; skill?: 'power'; directionX: number; directionY: number }
  | { kind: 'hit'; tick: number; x: number; y: number; strength: number; a: number; b: number }
  | { kind: 'hinge-hit'; tick: number; x: number; y: number; strength: number; stoneId: number; hingeId: string }
  | { kind: 'removed'; tick: number; stoneId: number; side: Side; x: number; y: number; vx: number; vy: number }
  | { kind: 'turn-ended'; tick: number; turn: number; side: Side }
  | { kind: 'match-ended'; tick: number; winner: Side | 'draw' };
export interface MatchSnapshot {
  format: 1; rulesVersion: string; engine: string; matchId: string;
  tick: number; turn: number; side: Side; phase: Phase; winner: Side | 'draw' | null;
  skillUsed: [boolean, boolean]; shotTicks: number; quietTicks: number; seenShots: string[]; commands: ShotCommand[];
  stones: Array<StoneSeed & { alive: boolean; bodyHandle: number; slideTicks: number; slideDistance: number }>;
  physics: Uint8Array;
}
