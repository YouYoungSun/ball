import type { ShotCommand, Side } from '../core/types.ts';
import type { ClientMessage, ServerMessage } from './protocol.ts';
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
/** Browser transport only. All physics and turn decisions belong to the server. */
export class OnlineClient {
  private socket?: WebSocket;
  private handlers = new Set<(message: ServerMessage) => void>();
  private statusHandlers = new Set<(status: ConnectionStatus) => void>();
  private retry?: ReturnType<typeof setTimeout>;
  private closed = false;
  private queue: ClientMessage[] = [];
  private session?: { code: string; token: string; side: Side };
  private lastEvent = 0;
  private matchId = '';
  private storageKey: string;
  readonly url: string;
  constructor(url: string) { this.url = url; this.storageKey = `alkkagi-session:${url}`; try { this.session = JSON.parse(sessionStorage.getItem(this.storageKey) || 'null') || undefined; } catch { /* storage may be blocked */ } }
  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.closed = false; this.status(this.session ? 'reconnecting' : 'connecting');
    const socket = this.socket = new WebSocket(this.url);
    socket.onopen = () => { this.status('connected'); if (this.session) this.send({ version: 1, kind: 'resume', ...this.session }); const queue = this.queue; this.queue = []; queue.forEach(m => this.send(m)); };
    socket.onmessage = event => {
      let message: ServerMessage; try { message = JSON.parse(event.data); } catch { return; }
      if (message.version !== 1) return;
      if (message.kind === 'session') { this.session = { code: message.code, token: message.token, side: message.side }; try { sessionStorage.setItem(this.storageKey, JSON.stringify(this.session)); } catch { /* optional persistence */ } }
      if (message.kind === 'error' && message.code === 'session-expired') this.clearSession();
      if (message.kind === 'state') {
        if (message.state.matchId !== this.matchId) { this.matchId = message.state.matchId; this.lastEvent = 0; }
        message.events = message.events.filter(e => e.seq > this.lastEvent);
        this.lastEvent = Math.max(this.lastEvent, message.seq);
      }
      this.handlers.forEach(fn => fn(message));
    };
    socket.onclose = event => { if (this.socket !== socket) return; if (event.code === 4001) { this.closed = true; this.clearSession(); this.handlers.forEach(fn => fn({ version: 1, kind: 'error', code: 'session-replaced', message: '다른 창에서 재접속하여 이 연결을 종료했습니다.' })); } this.status(this.closed ? 'disconnected' : 'reconnecting'); if (!this.closed) this.retry = setTimeout(() => this.connect(), 1200); };
    socket.onerror = () => socket.close();
  }
  private status(status: ConnectionStatus): void { this.statusHandlers.forEach(fn => fn(status)); }
  private send(message: ClientMessage): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); else { if (message.kind === 'shot' || message.kind === 'ready' || message.kind === 'rematch') { this.handlers.forEach(fn => fn({ version: 1, kind: 'error', code: 'not-connected', message: '연결이 복구된 후 다시 시도하세요.' })); return; } this.queue.push(message); this.connect(); } }
  private clearSession(): void { this.session = undefined; try { sessionStorage.removeItem(this.storageKey); } catch { /* optional persistence */ } }
  createRoom(): void { this.clearSession(); this.send({ version: 1, kind: 'create' }); }
  hasSession(code?: string): boolean { return !!this.session && (!code || this.session.code === code.trim().toUpperCase()); }
  joinRoom(code: string): void { if (this.hasSession(code)) { this.connect(); return; } this.clearSession(); this.send({ version: 1, kind: 'join', code: code.trim().toUpperCase() }); }
  ready(): void { this.send({ version: 1, kind: 'ready' }); }
  rematch(): void { this.send({ version: 1, kind: 'rematch' }); }
  shoot(command: ShotCommand): void { this.send({ version: 1, kind: 'shot', command }); }
  leave(): void { this.queue = []; if (this.socket?.readyState === WebSocket.OPEN) this.send({ version: 1, kind: 'leave' }); this.clearSession(); }
  onMessage(handler: (message: ServerMessage) => void): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  onStatus(handler: (status: ConnectionStatus) => void): () => void { this.statusHandlers.add(handler); return () => this.statusHandlers.delete(handler); }
  close(): void { this.closed = true; clearTimeout(this.retry); this.queue = []; this.socket?.close(); this.status('disconnected'); }
}
