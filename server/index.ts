import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { Game, initPhysics } from '../src/core/game.ts';
import { HostAuthority } from '../src/net/transport.ts';
import type { ClientMessage, RoomInfo, SequencedEvent, ServerMessage } from '../src/net/protocol.ts';
import type { Side } from '../src/core/types.ts';
interface Player { token: string; socket?: WebSocket; disconnectedAt?: number }
interface Room { code: string; players: [Player | undefined, Player | undefined]; ready: [boolean, boolean]; rematch: [boolean, boolean]; game?: Game; seq: number; events: SequencedEvent[]; touched: number; accumulator: number; lastBroadcast: number; accepted: Map<string, string> }
interface Peer { room?: Room; side?: Side; window: number; count: number }
export interface ServerOptions { port?: number; host?: string; reconnectGraceMs?: number; roomTtlMs?: number; maxRooms?: number }
export async function startServer(options: ServerOptions = {}) {
  await initPhysics();
  const rooms = new Map<string, Room>(), peers = new Map<WebSocket, Peer>();
  const attempts = new Map<string, { since: number; count: number }>();
  const grace = options.reconnectGraceMs ?? 30_000, ttl = options.roomTtlMs ?? 30 * 60_000;
  const http = createServer((req, res) => { res.writeHead(req.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(req.url === '/health' ? { ok: true, rooms: rooms.size } : { error: 'not found' })); });
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean);
  const wss = new WebSocketServer({ server: http, maxPayload: 4096, perMessageDeflate: false, verifyClient: ({ origin }: { origin: string }) => !allowedOrigins?.length || !origin || allowedOrigins.includes(origin) });
  const send = (socket: WebSocket | undefined, message: ServerMessage) => { if (socket?.readyState === WebSocket.OPEN) { if (socket.bufferedAmount > 256_000) socket.close(1013, 'Slow connection'); else socket.send(JSON.stringify(message)); } };
  const error = (socket: WebSocket, code: string, message: string) => send(socket, { version: 1, kind: 'error', code, message });
  const info = (room: Room): RoomInfo => ({ code: room.code, status: !room.game ? 'waiting' : room.game.state().phase === 'finished' ? 'finished' : 'playing', ready: room.ready, rematch: room.rematch, connected: room.players.map(p => p?.socket?.readyState === WebSocket.OPEN) as [boolean, boolean] });
  const broadcastRoom = (room: Room) => room.players.forEach(p => send(p?.socket, { version: 1, kind: 'room', room: info(room) }));
  const state = (room: Room, snapshot = false, socket?: WebSocket) => {
    if (!room.game) return;
    const message: ServerMessage = { version: 1, kind: 'state', state: room.game.state(), events: snapshot ? [] : room.events, seq: room.seq, snapshot };
    if (socket) send(socket, message); else { room.players.forEach(p => send(p?.socket, message)); room.events = []; }
    room.lastBroadcast = performance.now();
  };
  const collect = (room: Room) => { for (const event of room.game?.drainEvents() ?? []) room.events.push({ seq: ++room.seq, event }); };
  const destroy = (room: Room) => { room.game?.free(); rooms.delete(room.code); room.players.forEach(p => { if (p?.socket) { const peer = peers.get(p.socket); if (peer) { peer.room = undefined; peer.side = undefined; } error(p.socket, 'session-expired', '방이 종료되었습니다. 새 방을 만들어 주세요.'); } }); };
  const detach = (socket: WebSocket, explicit: boolean) => { const peer = peers.get(socket); if (!peer?.room || peer.side === undefined) return; const room = peer.room, player = room.players[peer.side]; if (player?.socket !== socket) return; player.socket = undefined; player.disconnectedAt = explicit ? Date.now() - grace : Date.now(); peer.room = undefined; peer.side = undefined; room.ready[0] = room.ready[1] = false; broadcastRoom(room); if (explicit) destroy(room); };
  const attach = (socket: WebSocket, room: Room, side: Side, player: Player) => {
    const old = player.socket; if (old && old !== socket) { const previous = peers.get(old); if (previous) { previous.room = undefined; previous.side = undefined; } old.close(4001, 'Session resumed elsewhere'); }
    player.socket = socket; player.disconnectedAt = undefined; const peer = peers.get(socket)!; peer.room = room; peer.side = side; room.touched = Date.now();
    send(socket, { version: 1, kind: 'session', code: room.code, side, token: player.token }); broadcastRoom(room); state(room, true, socket);
  };
  const start = (room: Room) => { room.game?.free(); room.game = new Game(randomUUID()); room.seq = 0; room.events = []; room.ready = [false, false]; room.rematch = [false, false]; room.accumulator = 0; room.accepted.clear(); room.touched = Date.now(); broadcastRoom(room); state(room, true); };
  const alive = new Set<WebSocket>();
  wss.on('connection', (socket, request) => {
    alive.add(socket); socket.on('pong', () => alive.add(socket));
    const ip = request.socket.remoteAddress ?? 'unknown';
    peers.set(socket, { window: Date.now(), count: 0 });
    socket.on('message', (raw, binary) => {
      const peer = peers.get(socket)!; const now = Date.now();
      if (now - peer.window > 1000) { peer.window = now; peer.count = 0; }
      if (++peer.count > 30) { error(socket, 'rate-limit', '요청이 너무 빠릅니다.'); return; }
      let message: ClientMessage;
      try { if (binary) throw Error(); message = JSON.parse(raw.toString()); if (!message || typeof message !== 'object' || message.version !== 1 || typeof message.kind !== 'string') throw Error(); } catch { error(socket, 'invalid', '잘못된 메시지입니다.'); return; }
      if (message.kind === 'create' || message.kind === 'join' || message.kind === 'resume') {
        let attempt = attempts.get(ip); if (!attempt || now - attempt.since > 60_000) { attempt = { since: now, count: 0 }; attempts.set(ip, attempt); }
        if (++attempt.count > 30) { error(socket, 'rate-limit', '잠시 뒤 다시 접속하세요.'); return; }
        if (peer.room) { error(socket, 'already-in-room', '먼저 현재 방에서 나가 주세요.'); return; }
        if (message.kind === 'create') {
          if (rooms.size >= (options.maxRooms ?? 200)) { error(socket, 'full', '서버가 가득 찼습니다.'); return; }
          let code: string; const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
          const player: Player = { token: randomBytes(24).toString('base64url') };
          const room: Room = { code, players: [player, undefined], ready: [false, false], rematch: [false, false], seq: 0, events: [], touched: now, accumulator: 0, lastBroadcast: 0, accepted: new Map() }; rooms.set(code, room); attach(socket, room, 0, player); return;
        }
        if (typeof message.code !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(message.code)) { error(socket, message.kind === 'resume' ? 'session-expired' : 'unavailable', '방을 찾을 수 없습니다.'); return; }
        const room = rooms.get(message.code);
        if (message.kind === 'resume') {
          const side = room?.players.findIndex(p => p?.token === message.token);
          const player = side === undefined || side < 0 ? undefined : room?.players[side];
          if (!room || !player || typeof message.token !== 'string' || (player.disconnectedAt !== undefined && now - player.disconnectedAt >= grace)) { error(socket, 'session-expired', '재접속 시간이 지났습니다. 새 방을 만들어 주세요.'); return; }
          attach(socket, room, side as Side, player); return;
        }
        if (!room || room.players[1] || room.game) { error(socket, 'unavailable', '입장할 수 없는 방입니다. 코드를 확인하세요.'); return; }
        const player: Player = { token: randomBytes(24).toString('base64url') }; room.players[1] = player; attach(socket, room, 1, player); return;
      }
      const room = peer.room, side = peer.side;
      if (!room || side === undefined) { error(socket, 'no-room', '먼저 방에 입장하세요.'); return; }
      room.touched = now;
      if (message.kind === 'leave') { detach(socket, true); return; }
      if (message.kind === 'ready' && !room.game) { room.ready[side] = true; broadcastRoom(room); if (room.ready.every(Boolean) && info(room).connected.every(Boolean)) start(room); return; }
      if (message.kind === 'rematch' && room.game?.state().phase === 'finished') { room.rematch[side] = true; broadcastRoom(room); if (room.rematch.every(Boolean) && info(room).connected.every(Boolean)) start(room); return; }
      if (message.kind === 'shot' && room.game) {
        const command = message.command;
        if (!command || typeof command !== 'object' || typeof command.shotId !== 'string' || command.shotId.length > 100) { error(socket, 'invalid', '잘못된 발사 명령입니다.'); return; }
        const key = `${side}:${command.shotId}`, serialized = JSON.stringify(command);
        if (room.accepted.get(key) === serialized) { send(socket, { version: 1, kind: 'ack', shotId: command.shotId, result: { accepted: true } }); return; }
        const result = info(room).connected.every(Boolean) ? new HostAuthority(room.game).receive(command, side) : { accepted: false as const, reason: '상대의 재접속을 기다리고 있습니다.' };
        send(socket, { version: 1, kind: 'ack', shotId: command.shotId, result }); if (result.accepted) { room.accepted.set(key, serialized); collect(room); state(room); } return;
      }
      error(socket, 'invalid-action', '지금 사용할 수 없는 요청입니다.');
    });
    socket.on('close', () => { detach(socket, false); peers.delete(socket); alive.delete(socket); });
    socket.on('error', () => socket.close());
  });
  const heartbeat = setInterval(() => { for (const socket of wss.clients) { if (!alive.delete(socket)) socket.terminate(); else socket.ping(); } }, 10_000);
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now(), elapsed = Math.min(250, now - previous); previous = now;
    for (const room of rooms.values()) {
      if (room.players.some(p => p?.disconnectedAt !== undefined && Date.now() - p.disconnectedAt >= grace) || Date.now() - room.touched > ttl) { destroy(room); continue; }
      if (room.game?.isMoving) {
        room.accumulator += elapsed;
        while (room.accumulator >= 1000 / 120 && room.game.isMoving) { room.game.stepFixed(); room.accumulator -= 1000 / 120; }
        collect(room);
        if (!room.game.isMoving || now - room.lastBroadcast >= 40) { state(room); if (room.game.state().phase === 'finished') broadcastRoom(room); }
      } else room.accumulator = 0;
    }
    for (const [ip, attempt] of attempts) if (Date.now() - attempt.since > 60_000) attempts.delete(ip);
  }, 4);
  try { await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(options.port ?? Number(process.env.PORT ?? 8787), options.host ?? '0.0.0.0', resolve); }); } catch (error) { clearInterval(timer); clearInterval(heartbeat); wss.close(); throw error; }
  return { http, wss, rooms, port: (http.address() as { port: number }).port, close: async () => { clearInterval(timer); clearInterval(heartbeat); peers.clear(); for (const room of rooms.values()) room.game?.free(); rooms.clear(); for (const socket of wss.clients) socket.terminate(); await new Promise<void>(resolve => wss.close(() => http.close(() => resolve()))); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer(); console.log(`Alkkagi authoritative WebSocket server listening on :${server.port}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
