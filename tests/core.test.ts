import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Game, initPhysics, makeShot } from '../src/core/game.ts';
import { RULES, HINGES, INITIAL_STONES, PIECES, maxImpulseFor } from '../src/core/rules.ts';
import { HostAuthority, LoopbackTransport } from '../src/net/transport.ts';
import { chooseShot } from '../src/players/ai.ts';

before(async () => { await initPhysics(); });
const hash = (g: Game) => createHash('sha256').update(g.snapshot().physics).digest('hex');
function settle(g: Game) { let ticks = 0; while (g.isMoving && ticks++ <= RULES.maxShotTicks) g.stepFixed(); assert.ok(ticks <= RULES.maxShotTicks + 1); }
function defaultShot(g: Game, id = 'shot-1') { const s = g.state().stones.find(s => s.id === 11)!; return makeShot(g.state(), s.id, 0, -maxImpulseFor(s.kind) + 2, id); }

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
    for (const bad of [{ ...c, turn: 0 }, { ...c, stoneId: 16 }, { ...c, side: 1 as const },
      { ...c, impulseX: NaN }, { ...c, impulseX: Infinity }, { ...c, impulseY: .5 },
      { ...c, impulseX: 99999999 }, { ...c, impulseX: 0, impulseY: 0 }, { ...c, matchId: 'old' }, { ...c, rulesVersion: 'old' }]) {
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
  const g = new Game('ccd', [{ id: 0, side: 0, x: 3, y: 2.6 }, { id: 1, side: 1, x: 3.68, y: 2.6 }]);
  try {
    assert.ok(g.shoot(makeShot(g.state(), 0, maxImpulseFor() - 2, 0, 'fast')).accepted);
    let hit = false;
    for (let i = 0; i < 50; i++) { g.stepFixed(); hit ||= g.drainEvents().some(e => e.kind === 'hit'); }
    assert.ok(hit); assert.ok(g.state().stones.find(s => s.id === 1)!.x > 4);
  } finally { g.free(); }
});

test('removing the last opponent stone resolves a win; out-of-bounds stones stop colliding', () => {
  const g = new Game('win', [{ id: 0, side: 0, x: 7.8, y: 2.6 }, { id: 1, side: 1, x: 8.5, y: 2.6 }]);
  try {
    g.shoot(makeShot(g.state(), 0, maxImpulseFor() - 2, 0, 'winner')); settle(g);
    assert.equal(g.state().phase, 'finished'); assert.equal(g.state().winner, 0);
    const events = g.drainEvents(); assert.ok(events.some(e => e.kind === 'removed')); assert.ok(events.some(e => e.kind === 'match-ended'));
  } finally { g.free(); }
});

test('simultaneous last-stone loss is an explicit draw', () => {
  // A legal checkpoint can contain an outward-moving pair at a shot boundary.
  const g = new Game('draw', [{ id: 0, side: 0, x: -.1, y: 2 }, { id: 1, side: 1, x: 9.1, y: 2 }]);
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

test('janggi has 16 pieces per army and different physical radii and masses', () => {
  const g = new Game('janggi-layout'); let restored: Game | undefined;
  try {
    const state = g.state();
    assert.equal(state.stones.length, 32);
    assert.equal(state.stones.filter(s => s.side === 0).length, 16);
    assert.equal(state.stones.filter(s => s.side === 1).length, 16);
    assert.ok(state.stones.filter(s => s.side === 0).every(s => s.y > 5));
    assert.ok(state.stones.filter(s => s.side === 1).every(s => s.y < 5));
    assert.ok(PIECES.king.radius > PIECES.chariot.radius && PIECES.chariot.radius > PIECES.soldier.radius);
    assert.ok(PIECES.king.mass > PIECES.chariot.mass && PIECES.chariot.mass > PIECES.soldier.mass);
    restored = Game.restore(g.snapshot()); assert.deepEqual(restored.state(), state); assert.equal(hash(restored), hash(g));
    assert.equal(INITIAL_STONES.length, 32);
  } finally { g.free(); restored?.free(); }
});

test('a soldier rebounds from a king and transfers much less speed than a king at the same launch speed', () => {
  function trial(kind: 'soldier' | 'king') {
    const g = new Game('mass-'+kind, [{id:0,side:0,kind,x:3,y:2.5},{id:1,side:1,kind:'king',x:4.1,y:2.5}]);
    try {
      g.shoot(makeShot(g.state(),0,PIECES[kind].mass * 6000,0,'same-speed'));
      let targetPeak = 0, rebound = 0;
      for(let i=0;i<100;i++) { g.stepFixed(); const s=g.state().stones; targetPeak=Math.max(targetPeak,s[1].vx); rebound=Math.min(rebound,s[0].vx); }
      return {targetPeak,rebound};
    } finally {g.free()}
  }
  const light=trial('soldier'), heavy=trial('king');
  console.log('mass response at 6 units/s:',{soldierIntoKing:light,kingIntoKing:heavy});
  assert.ok(light.rebound < -1);
  assert.ok(light.targetPeak < heavy.targetPeak * .6);
});

test('the authority validates each piece launch impulse limit', () => {
  const g=new Game('piece-limit',[{id:0,side:0,kind:'soldier',x:3,y:2},{id:1,side:1,kind:'king',x:6,y:2}]);
  try {
    assert.equal(g.shoot(makeShot(g.state(),0,maxImpulseFor('king')-2,0,'too-heavy')).accepted,false);
    assert.equal(g.shoot(makeShot(g.state(),0,maxImpulseFor('soldier')-2,0,'legal-small')).accepted,true);
  } finally {g.free()}
});

test('a raised side hinge blocks and rebounds a piece while the central seam stays open', () => {
  function shotAt(x:number) {
    const g=new Game('hinge-'+x,[{id:0,side:0,kind:'soldier',x,y:4.1},{id:1,side:1,kind:'soldier',x:7,y:8}]);
    try {
      g.shoot(makeShot(g.state(),0,0,maxImpulseFor('soldier')-2,'hinge-shot'));
      let hingeHit=false,minV=0,maxY=0;
      for(let i=0;i<90;i++){g.stepFixed();hingeHit ||= g.drainEvents().some(e=>e.kind==='hinge-hit');const s=g.state().stones[0];minV=Math.min(minV,s.vy);maxY=Math.max(maxY,s.y)}
      return {hingeHit,minV,maxY};
    } finally {g.free()}
  }
  const blocked=shotAt(HINGES[0].x), open=shotAt(4.5);
  assert.ok(blocked.hingeHit); assert.ok(blocked.minV < -1); assert.ok(blocked.maxY < 5);
  assert.equal(open.hingeHit,false); assert.ok(open.maxY > 6);
});

test('hinge geometry and collision events survive a moving checkpoint restore', () => {
  const a=new Game('hinge-resume',[{id:0,side:0,kind:'soldier',x:HINGES[0].x,y:4.1},{id:1,side:1,kind:'soldier',x:7,y:8}]);let b:Game|undefined;
  try {
    a.shoot(makeShot(a.state(),0,0,maxImpulseFor('soldier')-2,'hinge-resume'));for(let i=0;i<3;i++)a.stepFixed();a.drainEvents();
    b=Game.restore(a.snapshot()); let ah=false,bh=false;
    for(let i=0;i<120;i++){a.stepFixed();b.stepFixed();ah ||= a.drainEvents().some(e=>e.kind==='hinge-hit');bh ||= b.drainEvents().some(e=>e.kind==='hinge-hit')}
    assert.ok(ah&&bh);assert.deepEqual(a.state(),b.state());assert.equal(hash(a),hash(b));
  } finally {a.free();b?.free()}
});

test('different-sized pieces emit a radius-weighted contact point, not the center midpoint', () => {
  const g=new Game('contact-point',[{id:0,side:0,kind:'soldier',x:3,y:2.5},{id:1,side:1,kind:'king',x:4.1,y:2.5}]);
  try {
    g.shoot(makeShot(g.state(),0,5200,0,'contact'));
    let found=false;
    for(let i=0;i<80;i++){
      g.stepFixed();const hit=g.drainEvents().find(e=>e.kind==='hit');
      if(hit?.kind==='hit'){
        const [a,b]=g.state().stones;
        const expected=(a.x*PIECES.king.radius+b.x*PIECES.soldier.radius)/(PIECES.king.radius+PIECES.soldier.radius);
        assert.ok(Math.abs(hit.x-expected)<1e-5);assert.ok(Math.abs(hit.x-(a.x+b.x)/2)>.05);found=true;break;
      }
    }
    assert.ok(found);
  } finally {g.free()}
});

test('opening central soldier shots cannot chain the opposing central soldier into a king knockout', () => {
  const reports: Array<{power:number;duration:number;kingTravel:number;kingAlive:boolean;enemySoldierHit:boolean;kingHit:boolean}> = [];
  for (const power of [.4, .65, .8, 1]) {
    const g = new Game(`central-chain-${power}`);
    try {
      const initial = g.state();
      const striker = initial.stones.find(s => s.side === 0 && s.kind === 'soldier' && s.x === 4.5)!;
      const central = initial.stones.find(s => s.side === 1 && s.kind === 'soldier' && s.x === 4.5)!;
      const king = initial.stones.find(s => s.side === 1 && s.kind === 'king')!;
      assert.ok(g.shoot(makeShot(initial, striker.id, 0, -Math.floor((maxImpulseFor(striker.kind) - 2) * power), 'center')).accepted);
      let enemySoldierHit = false, kingHit = false;
      while (g.isMoving) {
        g.stepFixed();
        for (const event of g.drainEvents()) if (event.kind === 'hit') {
          enemySoldierHit ||= (event.a === striker.id && event.b === central.id) || (event.b === striker.id && event.a === central.id);
          kingHit ||= event.a === king.id || event.b === king.id;
        }
      }
      const final = g.state(), target = final.stones.find(s => s.id === king.id)!;
      assert.equal(target.alive, true, `king must survive opening power ${power}`);
      if (power === 1) {
        assert.ok(enemySoldierHit, 'maximum shot must still reach the enemy soldier line');
        assert.ok(kingHit, 'the chain is physically simulated rather than disabled');
        assert.ok(king.y - target.y > .5, 'the king visibly moves; it is not immune');
        assert.ok(final.tick / RULES.hz < 2, 'the opening chain must not retain a long skating tail');
      }
      reports.push({ power, duration: final.tick / RULES.hz, kingTravel: king.y - target.y, kingAlive: target.alive, enemySoldierHit, kingHit });
    } finally { g.free(); }
  }
  console.log('opening chain regression:', reports);
});

test('a full-speed flick keeps its first 150ms punch, then brakes within the board', () => {
  const g = new Game('dry-slide', [{ id: 0, side: 0, kind: 'soldier', x: .5, y: 2 }, { id: 1, side: 1, kind: 'king', x: 7, y: 8 }]);
  try {
    assert.ok(g.shoot(makeShot(g.state(), 0, maxImpulseFor('soldier') - 2, 0, 'slide')).accepted);
    assert.ok(Math.abs(g.state().stones[0].vx - 12) < .01, 'launch speed is restored');
    for (let i = 0; i < 18; i++) g.stepFixed();
    const early = g.state().stones[0];
    assert.ok(early.x - .5 > 1.7, 'the first 150ms is a fast visible flick');
    assert.ok(early.vx > 11, 'braking must not flatten the initial punch');
    let lastSlowTick = 0, stoppedTick = 0;
    while (g.isMoving) {
      g.stepFixed(); const s = g.state().stones[0];
      if (s.vx > 0 && s.vx < 1 && !lastSlowTick) lastSlowTick = g.state().tick;
      if (s.vx === 0 && !stoppedTick) stoppedTick = g.state().tick;
    }
    const state = g.state(), piece = state.stones[0];
    assert.ok(lastSlowTick > 0 && (stoppedTick - lastSlowTick) / RULES.hz < .12, 'slow tail stops promptly');
    assert.ok(piece.alive, 'the shot stops before skating all the way off the board');
    assert.ok(piece.x - .5 > 6 && piece.x - .5 < 8, 'a maximum flick retains range without an unlimited tail');
    assert.ok(state.tick / RULES.hz < 2.5);
    assert.equal(piece.vx, 0); assert.equal(piece.vy, 0);
    console.log('dry free slide:', { travel: piece.x - .5, seconds: state.tick / RULES.hz });
  } finally { g.free(); }
});

test('low-speed pieces come to an exact stop rather than drifting indefinitely', () => {
  const g = new Game('slow-stop', [{ id: 0, side: 0, kind: 'soldier', x: 3, y: 2 }, { id: 1, side: 1, kind: 'king', x: 7, y: 8 }]);
  try {
    assert.ok(g.shoot(makeShot(g.state(), 0, 390, 0, 'slow')).accepted);
    settle(g); const state = g.state(), piece = state.stones[0];
    assert.ok(state.tick / RULES.hz < .5); assert.ok(piece.x - 3 < .08);
    assert.equal(piece.vx, 0); assert.equal(piece.vy, 0);
  } finally { g.free(); }
});

test('a king near the edge can still be knocked out by a direct soldier hit', () => {
  const g = new Game('edge-king', [{ id: 0, side: 0, kind: 'soldier', x: 7.5, y: 2.5 }, { id: 1, side: 1, kind: 'king', x: 8.75, y: 2.5 }]);
  try {
    assert.ok(g.shoot(makeShot(g.state(), 0, maxImpulseFor('soldier') - 2, 0, 'edge')).accepted);
    settle(g); const state = g.state();
    assert.equal(state.stones[1].alive, false); assert.equal(state.winner, 0);
  } finally { g.free(); }
});


test('slide history checkpoints preserve launch grace and late braking, and reject invalid histories', () => {
  for (const ticks of [8, 35, 90]) {
    const a = new Game(`slide-history-${ticks}`, [{id:0,side:0,kind:'soldier',x:.5,y:2},{id:1,side:1,kind:'king',x:7,y:8}]);
    let b: Game | undefined;
    try {
      a.shoot(makeShot(a.state(), 0, maxImpulseFor('soldier') - 2, 0, 'history'));
      for (let i = 0; i < ticks; i++) a.stepFixed();
      const checkpoint = a.snapshot();
      assert.ok(checkpoint.stones[0].slideTicks > 0);
      assert.ok(checkpoint.stones[0].slideDistance > 0);
      assert.throws(() => Game.restore({...checkpoint, stones: checkpoint.stones.map(s => ({...s, slideTicks: -1}))}));
      assert.throws(() => Game.restore({...checkpoint, stones: checkpoint.stones.map(s => ({...s, slideDistance: NaN}))}));
      b = Game.restore(checkpoint);
      settle(a); settle(b);
      assert.deepEqual(a.state(), b.state()); assert.equal(hash(a), hash(b));
      assert.deepEqual(a.snapshot().stones, b.snapshot().stones);
    } finally { a.free(); b?.free(); }
  }
});

test('power applies 1.25 times the legal input impulse without changing normal physics', () => {
  const seeds = [{ id: 0, side: 0 as const, kind: 'soldier' as const, x: 2, y: 2 }, { id: 1, side: 1 as const, x: 7, y: 8 }];
  const normal = new Game('power-ratio', seeds), power = new Game('power-ratio', seeds);
  try {
    const input = maxImpulseFor('soldier');
    assert.ok(normal.shoot(makeShot(normal.state(), 0, input, 0, 'normal')).accepted);
    assert.ok(power.shoot(makeShot(power.state(), 0, input, 0, 'power', 'power')).accepted);
    assert.ok(Math.abs(normal.state().stones[0].vx - 12) < .001);
    assert.ok(Math.abs(power.state().stones[0].vx / normal.state().stones[0].vx - 1.25) < .000001);
    assert.deepEqual(normal.state().skillUsed, [false, false]);
    assert.deepEqual(power.state().skillUsed, [true, false]);
    assert.deepEqual(normal.drainEvents()[0], { kind: 'shot', tick: 0, stoneId: 0, power: 1, directionX: 1, directionY: 0 });
    assert.deepEqual(power.drainEvents()[0], { kind: 'shot', tick: 0, stoneId: 0, power: 1, skill: 'power', directionX: 1, directionY: 0 });
    const returned = power.state(); returned.skillUsed[0] = false;
    const checkpoint = power.snapshot(); checkpoint.skillUsed[0] = false;
    assert.deepEqual(power.state().skillUsed, [true, false], 'state and snapshots cannot mutate the live allowance');
  } finally { normal.free(); power.free(); }
});

test('power is independently available once per player and rejected shots never consume it', () => {
  const g = new Game('power-allowance');
  try {
    const shot = makeShot(g.state(), 1, 250, 0, 'first', 'power');
    for (const invalid of [{ ...shot, impulseX: maxImpulseFor('horse') + 1 }, { ...shot, stoneId: 16 },
      { ...shot, turn: 0 }, { ...shot, impulseX: 0 }, { ...shot, skill: 'unknown' }]) {
      assert.equal(g.shoot(invalid as typeof shot).accepted, false);
      assert.deepEqual(g.state().skillUsed, [false, false]);
    }
    assert.ok(g.shoot(shot).accepted); assert.equal(g.shoot(shot).accepted, false); settle(g);
    assert.deepEqual(g.state().skillUsed, [true, false]);
    const opponent = makeShot(g.state(), 17, -250, 0, 'opponent', 'power');
    assert.ok(g.shoot(opponent).accepted); settle(g);
    assert.deepEqual(g.state().skillUsed, [true, true]);
    assert.equal(g.shoot(makeShot(g.state(), 1, 250, 0, 'second-power', 'power')).accepted, false);
    assert.ok(g.shoot(makeShot(g.state(), 1, 250, 0, 'normal-after-power')).accepted); settle(g);
    assert.equal(g.shoot(makeShot(g.state(), 17, -250, 0, 'second-opponent-power', 'power')).accepted, false);
  } finally { g.free(); }
});

test('power commands replay and restore the same physics, flags, and remaining allowance', () => {
  const g = new Game('power-resume'), replay = new Game('power-resume'); let restored: Game | undefined;
  try {
    assert.ok(g.shoot(makeShot(g.state(), 1, 250, 0, 'power-open', 'power')).accepted);
    g.stepFixed(); restored = Game.restore(g.snapshot());
    assert.deepEqual(restored.state(), g.state()); assert.equal(hash(restored), hash(g));
    settle(g); settle(restored);
    assert.ok(g.shoot(makeShot(g.state(), 17, -250, 0, 'normal-reply')).accepted); settle(g);
    for (const command of g.shotLog()) { assert.ok(replay.shoot(command).accepted); settle(replay); }
    assert.deepEqual(replay.state(), g.state()); assert.equal(hash(replay), hash(g));
    assert.deepEqual(g.shotLog()[0].skill, 'power');
    const checkpoint = g.snapshot();
    assert.throws(() => Game.restore({ ...checkpoint, rulesVersion: 'janggi-alkkagi-4' }));
    for (const flags of [undefined, [false], [true, false, false], [1, false], [false, false]]) {
      assert.throws(() => Game.restore({ ...checkpoint, skillUsed: flags } as typeof checkpoint));
    }
    assert.throws(() => Game.restore({ ...checkpoint, commands: checkpoint.commands.map(c => ({ ...c, skill: 'unknown' })) } as unknown as typeof checkpoint));
    const settled = Game.restore(checkpoint);
    try {
      assert.equal(settled.shoot(makeShot(settled.state(), 1, 250, 0, 'restored-reuse', 'power')).accepted, false);
      assert.ok(settled.shoot(makeShot(settled.state(), 1, 250, 0, 'restored-normal')).accepted);
    } finally { settled.free(); }
  } finally { g.free(); replay.free(); restored?.free(); }
});
