import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from '../server/index.ts';
import { Game, makeShot } from '../src/core/game.ts';
import type { ServerMessage } from '../src/net/protocol.ts';
class Client {
  socket: WebSocket;
  messages: ServerMessage[] = [];
  constructor(url: string) { this.socket = new WebSocket(url); this.socket.on('message', raw => this.messages.push(JSON.parse(raw.toString()))); }
  async open() { await new Promise<void>((resolve, reject) => { this.socket.once('open', resolve); this.socket.once('error', reject); }); return this; }
  send(value: object) { this.socket.send(JSON.stringify({ version: 1, ...value })); }
  async take<K extends ServerMessage['kind']>(kind: K, predicate: (message: Extract<ServerMessage, {kind: K}>) => boolean = () => true, timeout = 6000): Promise<Extract<ServerMessage, {kind: K}>> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(m => m.kind === kind && predicate(m as Extract<ServerMessage, {kind: K}>));
      if (index >= 0) return this.messages.splice(index, 1)[0] as Extract<ServerMessage, {kind: K}>;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${kind}`);
  }
}
test('real sockets: two seats, readiness, authority, power, ordered events and token reconnect', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', reconnectGraceMs: 3000 });
  const url = `ws://127.0.0.1:${server.port}`;
  const clients: Client[] = [];
  const connect = async () => { const client = await new Client(url).open(); clients.push(client); return client; };
  try {
    const a = await connect(), b = await connect();
    a.send({ kind: 'create' }); const sessionA = await a.take('session'); assert.equal(sessionA.side, 0); assert.match(sessionA.code, /^[A-Z2-9]{6}$/);
    b.send({ kind: 'join', code: sessionA.code }); const sessionB = await b.take('session'); assert.equal(sessionB.side, 1);
    const intruder = await connect(); intruder.send({ kind: 'join', code: sessionA.code }); assert.equal((await intruder.take('error')).code, 'unavailable');
    a.send({ kind: 'ready' }); b.send({ kind: 'ready' });
    const initialA = await a.take('state'), initialB = await b.take('state'); assert.deepEqual(initialA.state, initialB.state); assert.equal(initialA.snapshot, true);
    const stone = initialA.state.stones.find(s => s.side === 0)!;
    const shot = { ...makeShot(initialA.state, stone.id, 300, 0, 'network-shot'), skill: 'power' as const };
    b.send({ kind: 'shot', command: shot }); assert.equal((await b.take('ack')).result.accepted, false);
    a.send({ kind: 'shot', command: shot }); assert.equal((await a.take('ack')).result.accepted, true);
    const movingA = await a.take('state', m => m.state.phase === 'moving'), movingB = await b.take('state', m => m.state.phase === 'moving');
    assert.deepEqual(movingA.state, movingB.state); assert.equal(movingA.state.skillUsed[0], true); assert.equal(movingA.events[0].seq, 1);
    a.send({ kind: 'shot', command: shot }); assert.equal((await a.take('ack')).result.accepted, true, 'same command retry is idempotent');
    a.send({ kind: 'shot', command: { ...shot, impulseX: 301 } }); assert.equal((await a.take('ack')).result.accepted, false);
    b.socket.terminate(); await a.take('room', m => !m.room.connected[1]);
    const resumed = await connect(); resumed.send({ kind: 'resume', code: sessionB.code, token: sessionB.token }); assert.equal((await resumed.take('session')).side, 1);
    const snap = await resumed.take('state'); assert.equal(snap.snapshot, true); assert.equal(snap.state.matchId, initialA.state.matchId); assert.equal(snap.state.skillUsed[0], true); assert.deepEqual(snap.events, []);
    const settled = await a.take('state', m => m.state.phase === 'aiming' && m.state.turn === 2, 12_000); assert.equal(settled.state.side, 1);
    const events = a.messages.filter(m => m.kind === 'state').flatMap(m => m.kind === 'state' ? m.events : []); events.push(...settled.events);
    const sequences = events.map(e => e.seq); assert.equal(new Set(sequences).size, sequences.length); assert.deepEqual([...sequences].sort((a,b)=>a-b), sequences);
    intruder.send({ kind: 'resume', code: sessionB.code, token: 'wrong' }); assert.equal((await intruder.take('error')).code, 'session-expired');
    a.send({ kind: 'leave' }); assert.equal((await resumed.take('error')).code, 'session-expired');
  } finally { clients.forEach(client => client.socket.terminate()); await server.close(); }
});
test('invalid payloads, expiration and health endpoint', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', reconnectGraceMs: 50 });
  const url = `ws://127.0.0.1:${server.port}`; const a = await new Client(url).open();
  try {
    assert.equal((await (await fetch(`http://127.0.0.1:${server.port}/health`)).json()).ok, true);
    a.socket.send('{'); assert.equal((await a.take('error')).code, 'invalid');
    a.send({ kind: 'create' }); const session = await a.take('session'); a.socket.terminate();
    await new Promise(resolve => setTimeout(resolve, 100));
    const b = await new Client(url).open(); try { b.send({kind: 'resume', code: session.code, token: session.token}); assert.equal((await b.take('error')).code, 'session-expired'); } finally { b.socket.terminate(); }
  } finally { a.socket.terminate(); await server.close(); }
});

test('real sockets: rematch requires both votes and creates a fresh match with reset skills', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  const url = `ws://127.0.0.1:${server.port}`;
  const a = await new Client(url).open(), b = await new Client(url).open();
  try {
    a.send({ kind: 'create' }); const session = await a.take('session');
    b.send({ kind: 'join', code: session.code }); await b.take('session');
    a.send({ kind: 'ready' }); b.send({ kind: 'ready' }); const initial = await a.take('state'); await b.take('state');
    // Deterministic near-edge board fixture; all play and votes still traverse actual sockets.
    const room = server.rooms.get(session.code)!; room.game!.free();
    room.game = new Game(initial.state.matchId, [{ id: 0, side: 0, kind: 'soldier', x: .01, y: 5 }, { id: 1, side: 1, kind: 'soldier', x: 7, y: 5 }]);
    a.send({ kind: 'shot', command: { ...makeShot(room.game.state(), 0, -300, 0, 'finish'), skill: 'power' } });
    assert.equal((await a.take('ack')).result.accepted, true);
    const finished = await a.take('state', m => m.state.phase === 'finished'); assert.equal(finished.state.winner, 1); assert.equal(finished.state.skillUsed[0], true);
    a.send({ kind: 'rematch' }); await a.take('room', m => m.room.rematch[0]);
    assert.equal(room.game.state().matchId, initial.state.matchId);
    b.send({ kind: 'rematch' }); const fresh = await a.take('state', m => m.state.matchId !== initial.state.matchId);
    assert.equal(fresh.snapshot, true); assert.equal(fresh.seq, 0); assert.equal(fresh.state.turn, 1); assert.deepEqual(fresh.state.skillUsed, [false, false]);
  } finally { a.socket.terminate(); b.socket.terminate(); await server.close(); }
});
