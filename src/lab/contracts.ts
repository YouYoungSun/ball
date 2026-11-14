import type { GameEvent, MatchState } from '../core/types.ts';
import type { Aim } from '../view/table.ts';
export interface LabView {
  shaking: boolean;
  effects: boolean;
  receive(events: GameEvent[], previous: MatchState): void;
  render(state: MatchState, dt: number, selected: number | null, aim: Aim | null, previous?: MatchState, alpha?: number): void;
  clear(): void;
  point(clientX: number, clientY: number): { x: number; y: number };
  setPreparation?(stoneId: number | null, power: number, armed: boolean): void;
}
export interface LabAudio {
  enabled: boolean;
  unlock(): Promise<void>;
  event(event: GameEvent, state?: MatchState): void;
  reset(): void;
  suspend(): void;
}
export interface Candidate { createView(canvas: HTMLCanvasElement): LabView; createAudio(): LabAudio }
