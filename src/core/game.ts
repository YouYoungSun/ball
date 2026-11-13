import RAPIER from '@dimforge/rapier2d-compat';
import { INITIAL_STONES, RULES } from './rules.ts';
import type { GameEvent, MatchSnapshot, MatchState, Phase, ShotCommand, ShotResult, Side, StoneSeed } from './types.ts';

let ready: Promise<void> | undefined;
export function initPhysics(): Promise<void> { return ready ??= RAPIER.init(); }
interface Stone extends StoneSeed { alive: boolean; bodyHandle: number }

/** No DOM, audio, network, random numbers, or wall-clock time in the rules. */
export class Game {
  private world: RAPIER.World;
  private queue = new RAPIER.EventQueue(true);
  private stones: Stone[] = [];
  private colliderToId = new Map<number, number>();
  private events: GameEvent[] = [];
  private seenShots = new Set<string>();
  private commands: ShotCommand[] = [];
  private matchId: string;
  private tick = 0;
  private turn = 1;
  private side: Side = 0;
  private phase: Phase = 'aiming';
  private winner: Side | 'draw' | null = null;
  private shotTicks = 0;
  private quietTicks = 0;

  constructor(matchId = 'local-match', seeds: readonly StoneSeed[] = INITIAL_STONES) {
    this.matchId = matchId;
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = RULES.dt;
    this.world.maxCcdSubsteps = 4;
    for (const seed of seeds) {
      const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(seed.x, seed.y)
        .setLinearDamping(RULES.damping).setAngularDamping(2).setCanSleep(false).setCcdEnabled(true);
      const body = this.world.createRigidBody(desc);
      const collider = this.world.createCollider(RAPIER.ColliderDesc.ball(RULES.radius)
        .setMass(1).setRestitution(RULES.restitution).setFriction(0)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      this.stones.push({ ...seed, alive: true, bodyHandle: body.handle });
      this.colliderToId.set(collider.handle, seed.id);
    }
  }

  state(): MatchState {
    return { matchId: this.matchId, tick: this.tick, turn: this.turn, side: this.side,
      phase: this.phase, winner: this.winner,
      stones: this.stones.map(s => {
        const b = this.world.getRigidBody(s.bodyHandle), p = b.translation(), v = b.linvel();
        return { id: s.id, side: s.side, alive: s.alive, x: p.x, y: p.y, vx: v.x, vy: v.y };
      }) };
  }
  get isMoving(): boolean { return this.phase === 'moving'; }

  shoot(c: ShotCommand): ShotResult {
    const reject = (reason: string): ShotResult => ({ accepted: false, reason });
    if (!c || c.kind !== 'shoot' || c.matchId !== this.matchId || c.rulesVersion !== RULES.version) return reject('다른 경기 또는 규칙입니다.');
    if (typeof c.shotId !== 'string' || !c.shotId || c.shotId.length > 100) return reject('잘못된 발사 번호입니다.');
    if (this.seenShots.has(c.shotId)) return reject('이미 처리한 발사입니다.');
    if (this.phase !== 'aiming') return reject('지금은 발사할 수 없습니다.');
    if (c.turn !== this.turn || c.side !== this.side) return reject('현재 차례가 아닙니다.');
    const stone = this.stones.find(s => s.id === c.stoneId && s.alive && s.side === c.side);
    if (!stone) return reject('내 돌을 선택하세요.');
    if (!Number.isSafeInteger(c.impulseX) || !Number.isSafeInteger(c.impulseY)) return reject('잘못된 발사 힘입니다.');
    const sizeSquared = c.impulseX ** 2 + c.impulseY ** 2;
    if (sizeSquared < RULES.minImpulse ** 2 || sizeSquared > RULES.maxImpulse ** 2) return reject('발사 힘이 허용 범위를 벗어났습니다.');
    this.seenShots.add(c.shotId);
    this.commands.push({ ...c });
    const b = this.world.getRigidBody(stone.bodyHandle);
    b.applyImpulse({ x: c.impulseX / RULES.impulseScale, y: c.impulseY / RULES.impulseScale }, true);
    this.phase = 'moving'; this.quietTicks = 0; this.shotTicks = 0;
    this.events.push({ kind: 'shot', tick: this.tick, stoneId: stone.id });
    return { accepted: true };
  }

  stepFixed(): void {
    if (this.phase !== 'moving') return;
    this.tick++; this.shotTicks++;
    const before = new Map(this.stones.filter(s => s.alive).map(s => [s.id, { ...this.world.getRigidBody(s.bodyHandle).linvel() }]));
    this.world.step(this.queue);
    this.queue.drainCollisionEvents((ha, hb, started) => {
      if (!started) return;
      const ia = this.colliderToId.get(ha), ib = this.colliderToId.get(hb);
      const a = this.stones.find(s => s.id === ia), b = this.stones.find(s => s.id === ib);
      if (!a?.alive || !b?.alive) return;
      const ap = this.world.getRigidBody(a.bodyHandle).translation(), bp = this.world.getRigidBody(b.bodyHandle).translation();
      const av = before.get(a.id)!, bv = before.get(b.id)!;
      const dx = bp.x - ap.x, dy = bp.y - ap.y, length = Math.hypot(dx, dy) || 1;
      const speed = Math.abs(((av.x - bv.x) * dx + (av.y - bv.y) * dy) / length);
      if (speed > .35) this.events.push({ kind: 'hit', tick: this.tick, x: (ap.x + bp.x) / 2,
        y: (ap.y + bp.y) / 2, strength: Math.min(1, speed / 10), a: a.id, b: b.id });
    });
    let quiet = true;
    for (const s of this.stones) {
      if (!s.alive) continue;
      const b = this.world.getRigidBody(s.bodyHandle), p = b.translation(), v = b.linvel();
      if (p.x < 0 || p.x > RULES.width || p.y < 0 || p.y > RULES.height) {
        s.alive = false;
        this.events.push({ kind: 'removed', tick: this.tick, stoneId: s.id, side: s.side, x: p.x, y: p.y, vx: v.x, vy: v.y });
        b.setEnabled(false);
      } else if (v.x * v.x + v.y * v.y > RULES.restSpeed ** 2) quiet = false;
    }
    this.quietTicks = quiet ? this.quietTicks + 1 : 0;
    if (this.quietTicks >= RULES.quietTicks || this.shotTicks >= RULES.maxShotTicks) this.finishShot();
  }

  private finishShot(): void {
    for (const s of this.stones) if (s.alive) {
      const b = this.world.getRigidBody(s.bodyHandle); b.setLinvel({ x: 0, y: 0 }, true); b.setAngvel(0, true);
    }
    const counts = [0, 0]; this.stones.forEach(s => { if (s.alive) counts[s.side]++; });
    if (!counts[0] || !counts[1] || this.turn >= RULES.maxTurns) {
      this.winner = !counts[0] && !counts[1] ? 'draw' : !counts[0] ? 1 : !counts[1] ? 0 : 'draw';
      this.phase = 'finished'; this.events.push({ kind: 'match-ended', tick: this.tick, winner: this.winner });
    } else {
      this.side = this.side === 0 ? 1 : 0; this.turn++; this.phase = 'aiming';
      this.events.push({ kind: 'turn-ended', tick: this.tick, turn: this.turn, side: this.side });
    }
  }

  drainEvents(): GameEvent[] { const events = this.events; this.events = []; return events; }
  shotLog(): ShotCommand[] { return this.commands.map(c => ({ ...c })); }
  snapshot(): MatchSnapshot {
    return { format: 1, rulesVersion: RULES.version, engine: RULES.engine, matchId: this.matchId,
      tick: this.tick, turn: this.turn, side: this.side, phase: this.phase, winner: this.winner,
      shotTicks: this.shotTicks, quietTicks: this.quietTicks, seenShots: [...this.seenShots], commands: this.shotLog(),
      stones: this.stones.map(s => ({ ...s })), physics: this.world.takeSnapshot() };
  }
  static restore(snapshot: MatchSnapshot): Game {
    if (!snapshot || snapshot.format !== 1 || snapshot.rulesVersion !== RULES.version || snapshot.engine !== RULES.engine) throw new Error('호환되지 않는 스냅샷입니다.');
    if (!(snapshot.physics instanceof Uint8Array) || snapshot.physics.byteLength > 1_000_000 ||
      !Array.isArray(snapshot.stones) || snapshot.stones.length > 6 ||
      !Array.isArray(snapshot.seenShots) || snapshot.seenShots.length > RULES.maxTurns ||
      !Array.isArray(snapshot.commands) || snapshot.commands.length > RULES.maxTurns) throw new Error('잘못된 스냅샷 형식입니다.');
    const g = new Game(snapshot.matchId, []);
    try {
    const world = RAPIER.World.restoreSnapshot(snapshot.physics); g.world.free(); g.world = world;
    g.tick = snapshot.tick; g.turn = snapshot.turn; g.side = snapshot.side; g.phase = snapshot.phase;
    g.winner = snapshot.winner; g.shotTicks = snapshot.shotTicks; g.quietTicks = snapshot.quietTicks;
    g.seenShots = new Set(snapshot.seenShots); g.commands = snapshot.commands.map(c => ({ ...c })); g.stones = snapshot.stones.map(s => ({ ...s }));
    for (const s of g.stones) {
      const b = g.world.getRigidBody(s.bodyHandle);
      for (let i = 0; i < b.numColliders(); i++) g.colliderToId.set(b.collider(i).handle, s.id);
    }
    return g;
    } catch (error) { g.free(); throw error; }
  }
  free(): void { this.queue.free(); this.world.free(); }
}

export function makeShot(state: MatchState, stoneId: number, x: number, y: number, shotId: string): ShotCommand {
  return { kind: 'shoot', matchId: state.matchId, rulesVersion: RULES.version,
    turn: state.turn, side: state.side, shotId, stoneId, impulseX: Math.round(x), impulseY: Math.round(y) };
}
