import type { MatchSnapshot, ShotCommand, ShotResult, Side } from '../core/types.ts';
import type { Game } from '../core/game.ts';

export type WireMessage =
  | { version: 1; kind: 'shot'; command: ShotCommand }
  | { version: 1; kind: 'ack'; shotId: string; result: ShotResult }
  | { version: 1; kind: 'checkpoint'; snapshot: MatchSnapshot };
export interface Transport {
  send(message: WireMessage): void;
  onMessage(handler: (message: WireMessage) => void): () => void;
  close(): void;
}

/** The in-process adapter proves the protocol boundary; it is not online PvP. */
export class LoopbackTransport implements Transport {
  private peer?: LoopbackTransport;
  private handlers = new Set<(message: WireMessage) => void>();
  private closed = false;
  static pair(): [LoopbackTransport, LoopbackTransport] {
    const a = new LoopbackTransport(), b = new LoopbackTransport(); a.peer = b; b.peer = a; return [a, b];
  }
  send(message: WireMessage): void {
    if (this.closed) throw new Error('연결이 닫혔습니다.');
    const copy = structuredClone(message), peer = this.peer;
    queueMicrotask(() => { if (!peer?.closed) peer?.handlers.forEach(fn => fn(copy)); });
  }
  onMessage(handler: (message: WireMessage) => void): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  close(): void { this.closed = true; this.handlers.clear(); }
}

/** assignedSide comes from the session, never from a client's claimed identity. */
export class HostAuthority {
  private game: Game;
  constructor(game: Game) { this.game = game; }
  receive(command: ShotCommand, assignedSide: Side): ShotResult {
    if (!command || typeof command !== 'object') return { accepted: false, reason: '잘못된 발사 명령입니다.' };
    if (command.side !== assignedSide) return { accepted: false, reason: '상대의 돌을 조작할 수 없습니다.' };
    return this.game.shoot(command);
  }
  checkpoint(): MatchSnapshot { return this.game.snapshot(); }
}
