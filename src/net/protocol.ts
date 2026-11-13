import type { GameEvent, MatchState, ShotCommand, ShotResult, Side } from '../core/types.ts';
export type RoomStatus = 'waiting' | 'playing' | 'finished';
export interface RoomInfo { code: string; status: RoomStatus; connected: [boolean, boolean]; ready: [boolean, boolean]; rematch: [boolean, boolean] }
export interface SequencedEvent { seq: number; event: GameEvent }
export type ClientMessage =
 | { version: 1; kind: 'create' }
 | { version: 1; kind: 'join'; code: string }
 | { version: 1; kind: 'resume'; code: string; token: string }
 | { version: 1; kind: 'ready' | 'rematch' | 'leave' }
 | { version: 1; kind: 'shot'; command: ShotCommand };
export type ServerMessage =
 | { version: 1; kind: 'session'; code: string; side: Side; token: string }
 | { version: 1; kind: 'room'; room: RoomInfo }
 | { version: 1; kind: 'state'; state: MatchState; events: SequencedEvent[]; seq: number; snapshot: boolean }
 | { version: 1; kind: 'ack'; shotId: string; result: ShotResult }
 | { version: 1; kind: 'error'; code: string; message: string };
