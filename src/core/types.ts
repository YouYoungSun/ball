export type Side = 0 | 1;
export type Phase = 'aiming' | 'moving' | 'finished';
export interface StoneSeed { id: number; side: Side; x: number; y: number }
export interface StoneState extends StoneSeed { alive: boolean; vx: number; vy: number }
export interface MatchState {
  matchId: string; tick: number; turn: number; side: Side; phase: Phase;
  winner: Side | 'draw' | null; stones: StoneState[];
}
export interface ShotCommand {
  kind: 'shoot'; matchId: string; rulesVersion: string; turn: number;
  shotId: string; side: Side; stoneId: number; impulseX: number; impulseY: number;
}
export type ShotResult = { accepted: true } | { accepted: false; reason: string };
export type GameEvent =
  | { kind: 'shot'; tick: number; stoneId: number }
  | { kind: 'hit'; tick: number; x: number; y: number; strength: number; a: number; b: number }
  | { kind: 'removed'; tick: number; stoneId: number; side: Side; x: number; y: number; vx: number; vy: number }
  | { kind: 'turn-ended'; tick: number; turn: number; side: Side }
  | { kind: 'match-ended'; tick: number; winner: Side | 'draw' };
export interface MatchSnapshot {
  format: 1; rulesVersion: string; engine: string; matchId: string;
  tick: number; turn: number; side: Side; phase: Phase; winner: Side | 'draw' | null;
  shotTicks: number; quietTicks: number; seenShots: string[]; commands: ShotCommand[];
  stones: Array<StoneSeed & { alive: boolean; bodyHandle: number }>;
  physics: Uint8Array;
}
