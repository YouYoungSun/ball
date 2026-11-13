import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Game, initPhysics, makeShot } from '../src/core/game.ts';
import { RULES } from '../src/core/rules.ts';
import { HostAuthority, LoopbackTransport } from '../src/net/transport.ts';
import { chooseShot } from '../src/players/ai.ts';

before(async () => { await initPhysics(); });
const hash = (g: Game) => createHash('sha256').update(g.snapshot().physics).digest('hex');
function settle(g: Game) { let ticks = 0; while (g.isMoving && ticks++ <= RULES.maxShotTicks) g.stepFixed(); assert.ok(ticks <= RULES.maxShotTicks + 1); }
function defaultShot(g: Game, id = 'shot-1') { return makeShot(g.state(), 1, 11998, 0, id); }

test('same commands give identical physics and state on two independent cores', () => {
  const a = new Game('same'), b = new Game('same');
  try {
    const shot = defaultShot(a); assert.ok(a.shoot(shot).accepted); assert.ok(b.shoot(shot).accepted);
    for (let i = 0; i < 180; i++) { a.stepFixed(); b.stepFixed(); }
    assert.equal(hash(a), hash(b)); assert.deepEqual(a.state(), b.state());
    settle(a); settle(b); assert.equal(hash(a), hash(b)); assert.deepEqual(a.state(), b.state());
  } finally { a.free(); b.free(); }
});

test('a moving-world checkpoint restores and continues identically', () => {
  const a = new Game('resume'); let b: Game | undefined;
  try {
    a.shoot(defaultShot(a)); for (let i = 0; i < 67; i++) a.stepFixed();
    b = Game.restore(a.snapshot()); assert.equal(hash(a), hash(b));
    settle(a); settle(b); assert.deepEqual(a.state(), b.state()); assert.equal(hash(a), hash(b));
  } finally { a.free(); b?.free(); }
});

test('observing and draining effects does not change game results', () => {
  const a = new Game('effects'), b = new Game('effects');
  try {
    a.shoot(defaultShot(a)); b.shoot(defaultShot(b));
    for (let i = 0; i < 1200; i++) { a.stepFixed(); a.drainEvents(); a.state(); b.stepFixed(); }
    assert.equal(hash(a), hash(b)); assert.deepEqual(a.state(), b.state());
  } finally { a.free(); b.free(); }
});

test('old turns, opponent stones, invalid forces, duplicates, and shots during movement are refused', () => {
  const g = new Game();
  try {
    const c = defaultShot(g);
    for (const bad of [{ ...c, turn: 0 }, { ...c, stoneId: 3 }, { ...c, side: 1 as const },
      { ...c, impulseX: NaN }, { ...c, impulseX: Infinity }, { ...c, impulseY: .5 },
      { ...c, impulseX: 99999999 }, { ...c, impulseX: 0 }, { ...c, matchId: 'old' }, { ...c, rulesVersion: 'old' }]) {
      assert.equal(g.shoot(bad).accepted, false); assert.equal(g.state().phase, 'aiming');
    }
    assert.equal(g.shoot(c).accepted, true);
    assert.equal(g.shoot(c).accepted, false);
    assert.equal(g.shoot({ ...c, shotId: 'another' }).accepted, false);
    settle(g); assert.equal(g.shoot(c).accepted, false);
  } finally { g.free(); }
});

test('shot and turn transitions are fixed-tick events, and moving shots always finish', () => {
  const g = new Game();
  try {
    g.shoot(makeShot(g.state(), 1, 250, 0, 'tiny')); settle(g);
    assert.equal(g.state().phase, 'aiming'); assert.equal(g.state().side, 1); assert.equal(g.state().turn, 2);
    assert.ok(g.drainEvents().some(e => e.kind === 'turn-ended'));
    assert.ok(g.state().stones.every(s => s.vx === 0 && s.vy === 0));
  } finally { g.free(); }
});

test('CCD detects a fast head-on impact; the target moves and a hit is emitted', () => {
  const g = new Game('ccd', [{ id: 0, side: 0, x: 3, y: 2.6 }, { id: 1, side: 1, x: 3.58, y: 2.6 }]);
  try {
    assert.ok(g.shoot(makeShot(g.state(), 0, 11998, 0, 'fast')).accepted);
    let hit = false;
    for (let i = 0; i < 50; i++) { g.stepFixed(); hit ||= g.drainEvents().some(e => e.kind === 'hit'); }
    assert.ok(hit); assert.ok(g.state().stones.find(s => s.id === 1)!.x > 4);
  } finally { g.free(); }
});

test('removing the last opponent stone resolves a win; out-of-bounds stones stop colliding', () => {
  const g = new Game('win', [{ id: 0, side: 0, x: 6.8, y: 2.6 }, { id: 1, side: 1, x: 7.5, y: 2.6 }]);
  try {
    g.shoot(makeShot(g.state(), 0, 11998, 0, 'winner')); settle(g);
    assert.equal(g.state().phase, 'finished'); assert.equal(g.state().winner, 0);
    const events = g.drainEvents(); assert.ok(events.some(e => e.kind === 'removed')); assert.ok(events.some(e => e.kind === 'match-ended'));
  } finally { g.free(); }
});

test('simultaneous last-stone loss is an explicit draw', () => {
  // A legal checkpoint can contain an outward-moving pair at a shot boundary.
  const g = new Game('draw', [{ id: 0, side: 0, x: -.1, y: 2 }, { id: 1, side: 1, x: 8.1, y: 2 }]);
  try { g.shoot(makeShot(g.state(), 0, -250, 0, 'draw')); settle(g); assert.equal(g.state().winner, 'draw'); }
  finally { g.free(); }
});

test('incompatible checkpoints are refused', () => {
  const g = new Game();
  try { assert.throws(() => Game.restore({ ...g.snapshot(), rulesVersion: 'future' })); assert.throws(() => Game.restore({ ...g.snapshot(), engine: 'other' })); }
  finally { g.free(); }
});

test('damaged checkpoint handles are rejected and a valid world still restores afterwards', () => {
  const g = new Game(); let restored: Game | undefined;
  try {
    const snapshot = g.snapshot();
    assert.throws(() => Game.restore({ ...snapshot, stones: [{ ...snapshot.stones[0], bodyHandle: 123456789 }] }));
    restored = Game.restore(snapshot); assert.deepEqual(restored.state(), g.state());
  } finally { restored?.free(); g.free(); }
});

test('deduplication survives checkpoint restoration', () => {
  const g = new Game('dedup'); let restored: Game | undefined;
  try { const c = defaultShot(g); g.shoot(c); settle(g); restored = Game.restore(g.snapshot()); assert.equal(restored.shoot(c).accepted, false); }
  finally { g.free(); restored?.free(); }
});

test('the host binds commands to the assigned player identity', () => {
  const g = new Game('host');
  try { const host = new HostAuthority(g), c = defaultShot(g); assert.equal(host.receive(null as never, 0).accepted, false); assert.equal(host.receive(c, 1).accepted, false); assert.equal(host.receive(c, 0).accepted, true); }
  finally { g.free(); }
});

test('transport sends isolated copies of commands and checkpoints', async () => {
  const [a, b] = LoopbackTransport.pair(), g = new Game('wire');
  try {
    const snapshot = g.snapshot();
    const received = new Promise<void>(resolve => b.onMessage(message => {
      assert.equal(message.kind, 'checkpoint');
      if (message.kind === 'checkpoint') { assert.notEqual(message.snapshot.physics, snapshot.physics); assert.deepEqual(message.snapshot.physics, snapshot.physics); }
      resolve();
    }));
    a.send({ version: 1, kind: 'checkpoint', snapshot }); await received;
    a.close(); assert.throws(() => a.send({ version: 1, kind: 'shot', command: defaultShot(g) }));
  } finally { a.close(); b.close(); g.free(); }
});

test('the AI uses a legal command and leaves its input checkpoint unchanged', () => {
  const g = new Game('ai');
  try {
    g.shoot(makeShot(g.state(), 1, 250, 0, 'human')); settle(g);
    const before = g.snapshot(), digest = hash(g), c = chooseShot(before, 'easy');
    assert.ok(c); assert.equal(hash(g), digest); assert.ok(g.shoot(c).accepted);
  } finally { g.free(); }
});

test('loopback host accepts a remote command and restores its final checkpoint on the guest', async () => {
  const hostGame = new Game('session'), guestGame = new Game('session');
  const authority = new HostAuthority(hostGame), [host, guest] = LoopbackTransport.pair();
  let restored: Game | undefined;
  try {
    host.onMessage(message => {
      if (message.kind !== 'shot') return;
      const answer = authority.receive(message.command, 0);
      host.send({ version: 1, kind: 'ack', shotId: message.command.shotId, result: answer });
      if (answer.accepted) { settle(hostGame); host.send({ version: 1, kind: 'checkpoint', snapshot: authority.checkpoint() }); }
    });
    const finished = new Promise<void>(resolve => guest.onMessage(message => {
      if (message.kind === 'ack') assert.ok(message.result.accepted);
      if (message.kind === 'checkpoint') { restored = Game.restore(message.snapshot); resolve(); }
    }));
    const c = defaultShot(guestGame); guestGame.shoot(c); settle(guestGame);
    guest.send({ version: 1, kind: 'shot', command: c }); await finished;
    assert.deepEqual(restored!.state(), hostGame.state()); assert.equal(hash(restored!), hash(guestGame));
    assert.deepEqual(restored!.shotLog(), [c]);
  } finally { host.close(); guest.close(); hostGame.free(); guestGame.free(); restored?.free(); }
});

test('accepted shot logs replay several turns to the same final state', () => {
  const game = new Game('replay'), replay = new Game('replay');
  try {
    for (let i = 0; i < 6 && game.state().phase !== 'finished'; i++) {
      const state = game.state(), own = state.stones.find(s => s.alive && s.side === state.side)!;
      game.shoot(makeShot(state, own.id, state.side ? -250 : 250, 0, `replay-${i}`)); settle(game);
    }
    for (const c of game.shotLog()) { assert.ok(replay.shoot(c).accepted); settle(replay); }
    assert.deepEqual(game.state(), replay.state()); assert.equal(hash(game), hash(replay));
  } finally { game.free(); replay.free(); }
});
