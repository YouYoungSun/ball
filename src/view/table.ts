import { HINGES, RULES, pieceSpec } from '../core/rules.ts';
import type { GameEvent, MatchState, StoneState } from '../core/types.ts';

export const TABLE = { x: 30, y: 30, w: 1040, h: 1040 / 9 * 10, width: 1100, height: 1220 };
const SCALE = TABLE.w / RULES.width;
const project = (x: number, y: number) => ({ x: TABLE.x + x * SCALE, y: TABLE.y + y * SCALE });
interface Flash { x: number; y: number; age: number; strength: number; metal: boolean; nx: number; ny: number; mass: number; powered: boolean }
interface Falling { stone: StoneState; age: number }
interface ShotTrail { age: number; x: number; y: number }
interface PowerStroke { age: number; x: number; y: number; nx: number; ny: number; power: number }
interface Kick { age: number; x: number; y: number }
export interface Aim { stoneId: number; x: number; y: number }
const random = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

/** Visual time, camera movement and particles never modify the rules or physics. */
export class TableView {
  shaking = true;
  effects = true;
  private ctx: CanvasRenderingContext2D;
  private backdrop: HTMLCanvasElement;
  private flashes: Flash[] = [];
  private falls: Falling[] = [];
  private trails = new Map<number, ShotTrail>();
  private kicks: Kick[] = [];
  private powerStrokes: PowerStroke[] = [];
  private poweredStone: number | null = null;
  private canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d')!;
    this.backdrop = document.createElement('canvas'); this.backdrop.width = TABLE.width; this.backdrop.height = TABLE.height;
    this.paintBoard(this.backdrop.getContext('2d')!);
  }
  clear(): void { this.flashes = []; this.falls = []; this.trails.clear(); this.kicks = []; this.powerStrokes = []; this.poweredStone = null; }
  receive(events: GameEvent[], previous: MatchState): void {
    const latestTick = Math.max(previous.tick, ...events.map(e => e.tick));
    for (const e of events) {
      // Network batches preserve event age instead of replaying every mark as fresh.
      const age = Math.max(0, (latestTick - e.tick) * RULES.dt);
      if (e.kind === 'shot') {
        const s = previous.stones.find(s => s.id === e.stoneId);
        this.poweredStone = e.skill === 'power' ? e.stoneId : null;
        if (s) {
          this.trails.set(s.id, { age, x: s.x, y: s.y });
          if (e.skill === 'power') this.powerStrokes.push({ age, ...project(s.x, s.y), nx: e.directionX, ny: e.directionY, power: e.power });
        }
      }
      if (e.kind === 'hit' || e.kind === 'hinge-hit') {
        const p = project(e.x, e.y), metal = e.kind === 'hinge-hit';
        const a = previous.stones.find(s => s.id === (e.kind === 'hit' ? e.a : e.stoneId));
        const b = e.kind === 'hit' ? previous.stones.find(s => s.id === e.b) : undefined;
        // The contact normal determines the mark and the single camera recoil.
        let nx = b && a ? b.x - a.x : a ? e.x - a.x : 0;
        let ny = b && a ? b.y - a.y : a ? e.y - a.y : 1;
        const length = Math.hypot(nx, ny) || 1; nx /= length; ny /= length;
        if (a && (a.vx - (b?.vx ?? 0)) * nx + (a.vy - (b?.vy ?? 0)) * ny < 0) { nx *= -1; ny *= -1; }
        const mass = b && a ? Math.sqrt(pieceSpec(a.kind).mass * pieceSpec(b.kind).mass) : pieceSpec(a?.kind).mass;
        const strength = Math.max(0, Math.min(1, e.strength));
        const powered = this.poweredStone !== null && (e.kind === 'hit' ? e.a === this.poweredStone || e.b === this.poweredStone : e.stoneId === this.poweredStone);
        if (strength > .07) this.flashes.push({ ...p, age, strength, metal, nx, ny, mass, powered });
        if (powered) this.poweredStone = null;
        // Both fast participants can leave a short wake after an actual contact.
        if (strength > .18) for (const stone of [a, b]) {
          if (stone && !this.trails.has(stone.id)) this.trails.set(stone.id, { age, x: stone.x, y: stone.y });
        }
        if (strength > .24) {
          const amplitude = Math.min(6.5, Math.pow((strength - .24) / .76, 1.2) * (3.8 + mass * 1.15) + (powered ? 1.1 : 0)) * (metal ? .8 : 1);
          this.kicks.push({ age, x: nx * amplitude, y: ny * amplitude });
        }
      }
      if (e.kind === 'turn-ended') this.poweredStone = null;
      if (e.kind === 'removed') {
        if (e.stoneId === this.poweredStone) this.poweredStone = null;
        const stone = previous.stones.find(s => s.id === e.stoneId);
        if (stone) this.falls.push({ stone: { ...stone, x: e.x, y: e.y, vx: e.vx, vy: e.vy }, age });
        this.trails.delete(e.stoneId);
      }
    }
  }
  render(state: MatchState, dt: number, selected: number | null, aim: Aim | null, previous?: MatchState, alpha = 1): void {
    const ctx = this.ctx;
    this.flashes.forEach(f => f.age += dt); this.falls.forEach(f => f.age += dt);
    this.flashes = this.flashes.filter(f => f.age < (f.powered ? .34 : .075 + f.strength * .065)); this.falls = this.falls.filter(f => f.age < .7);
    this.powerStrokes.forEach(s => s.age += dt); this.powerStrokes = this.powerStrokes.filter(s => s.age < .19);
    this.kicks.forEach(k => k.age += dt); this.kicks = this.kicks.filter(k => k.age < .105);
    ctx.clearRect(0, 0, TABLE.width, TABLE.height); ctx.save();
    if (this.shaking && this.effects) {
      let x = 0, y = 0;
      for (const k of this.kicks) { const t = k.age / .105, recoil = Math.exp(-t * 5) * Math.cos(t * Math.PI * 1.5); x += k.x * recoil; y += k.y * recoil; }
      const length = Math.hypot(x, y), limit = length > 6.5 ? 6.5 / length : 1;
      ctx.translate(x * limit, y * limit);
    }
    ctx.drawImage(this.backdrop, 0, 0);
    const stones = state.stones.filter(s => s.alive).map(s => {
      const old = previous?.stones.find(o => o.id === s.id);
      return old?.alive ? { ...s, x: old.x + (s.x - old.x) * alpha, y: old.y + (s.y - old.y) * alpha } : s;
    });
    if (this.effects) for (const stroke of this.powerStrokes) this.powerStroke(stroke);
    for (const s of stones) {
      const speed = Math.hypot(s.vx, s.vy), spec = pieceSpec(s.kind), trail = this.trails.get(s.id);
      if (!trail) continue;
      trail.age += dt;
      if (trail.age >= .11 || (trail.age > .025 && speed < 4.2)) { this.trails.delete(s.id); continue; }
      if (this.effects && speed >= 4.2) {
        const nx = s.vx / speed, ny = s.vy / speed, radius = spec.radius * SCALE;
        const p = project(s.x, s.y), travel = Math.hypot(s.x - trail.x, s.y - trail.y);
        const length = Math.min(.85, Math.max(.20, travel + speed * .026)) * SCALE;
        const rearX = p.x - nx * radius * .65, rearY = p.y - ny * radius * .65;
        ctx.save(); ctx.globalAlpha = Math.min(1, (speed - 3.5) / 3) * (1 - trail.age / .11);
        const gradient = ctx.createLinearGradient(rearX - nx * length, rearY - ny * length, rearX, rearY);
        gradient.addColorStop(0, 'rgba(96,62,33,0)'); gradient.addColorStop(1, 'rgba(91,55,27,.30)');
        ctx.strokeStyle = gradient; ctx.lineWidth = radius * .75; ctx.lineCap = 'butt'; ctx.beginPath();
        ctx.moveTo(rearX - nx * length, rearY - ny * length); ctx.lineTo(rearX, rearY); ctx.stroke();
        ctx.strokeStyle = '#ffedbd'; ctx.globalAlpha *= .45; ctx.lineWidth = 1.6;
        for (const side of [-1, 1]) { const ox = -ny * radius * .55 * side, oy = nx * radius * .55 * side; ctx.beginPath(); ctx.moveTo(rearX + ox - nx * length * .75, rearY + oy - ny * length * .75); ctx.lineTo(rearX + ox - nx * 4, rearY + oy - ny * 4); ctx.stroke(); }
        ctx.restore();
      }
    }
    if (this.effects) for (const s of stones) if (s.id === this.poweredStone) this.powerWake(s);
    for (const s of stones.sort((a, b) => a.y - b.y)) this.stone(s);
    for (const f of this.falls) this.stone({ ...f.stone, x: f.stone.x + f.stone.vx * f.age * .1, y: f.stone.y + f.stone.vy * f.age * .1 }, f.age / .7);
    if (state.phase === 'aiming' && selected !== null) { const s = stones.find(s => s.id === selected); if (s) this.drawAim(s, aim); }
    if (this.effects) for (const f of this.flashes) this.flash(f);
    ctx.restore();
  }
  point(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width * TABLE.width - TABLE.x) / SCALE,
      y: ((clientY - r.top) / r.height * TABLE.height - TABLE.y) / SCALE };
  }
  private drawAim(s: StoneState, aim: Aim | null): void {
    const ctx = this.ctx, p = project(s.x, s.y), spec = pieceSpec(s.kind), radius = spec.radius * SCALE;
    ctx.save(); ctx.strokeStyle = s.side ? '#9d392b' : '#335f7c'; ctx.lineWidth = 2; ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.arc(p.x, p.y, radius + 8, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    if (aim) {
      const dx = s.x - aim.x, dy = s.y - aim.y, length = Math.hypot(dx, dy) || 1, angle = Math.atan2(dy, dx), force = Math.min(1, length / 1.6);
      ctx.strokeStyle = '#49351f'; ctx.lineWidth = 2; ctx.setLineDash([5, 8]); ctx.beginPath(); ctx.moveTo(p.x + Math.cos(angle) * (radius + 12), p.y + Math.sin(angle) * (radius + 12)); ctx.lineTo(p.x + Math.cos(angle) * (radius + 65 + force * 90), p.y + Math.sin(angle) * (radius + 65 + force * 90)); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = s.side ? '#a03d2d' : '#315f85'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y, radius + 10, -Math.PI / 2, -Math.PI / 2 + force * Math.PI * 2); ctx.stroke();
      const text = `${spec.name} · 힘 ${Math.round(force * 100)}%`;
      ctx.font = '600 17px sans-serif'; const width = ctx.measureText(text).width + 24;
      const tx = Math.max(TABLE.x + width / 2, Math.min(TABLE.x + TABLE.w - width / 2, p.x));
      const ty = p.y > TABLE.y + TABLE.h - 95 ? p.y - radius - 37 : p.y + radius + 36;
      ctx.fillStyle = '#2f261ded'; ctx.fillRect(tx - width / 2, ty - 19, width, 29); ctx.fillStyle = '#f4dfb5'; ctx.textAlign = 'center'; ctx.fillText(text, tx, ty + 2);
    }
    ctx.restore();
  }
  private octagon(ctx: CanvasRenderingContext2D, radius: number, yOffset = 0): void {
    ctx.beginPath(); for (let i = 0; i < 8; i++) { const angle = Math.PI / 8 + i * Math.PI / 4; const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius + yOffset; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath();
  }
  private stone(s: StoneState, fall = 0): void {
    const ctx = this.ctx, p = project(s.x, s.y), spec = pieceSpec(s.kind), radius = spec.radius * SCALE, depth = 3 + spec.mass * 1.9;
    ctx.save(); ctx.globalAlpha = 1 - fall; ctx.translate(p.x, p.y + fall * fall * 140); ctx.scale(1 - fall * .65, 1 - fall * .65); ctx.rotate(fall * (s.side ? -1.7 : 1.7));
    ctx.save(); ctx.shadowColor = '#2c1a0780'; ctx.shadowBlur = radius * .16; ctx.shadowOffsetX = 3 + spec.mass * .6; ctx.shadowOffsetY = 7 + spec.mass; ctx.fillStyle = '#74502c'; this.octagon(ctx, radius, depth); ctx.fill(); ctx.restore();
    const side = ctx.createLinearGradient(0, -radius, 0, radius + depth); side.addColorStop(0, '#bd8d4b'); side.addColorStop(1, '#7b502c'); ctx.fillStyle = side; this.octagon(ctx, radius, depth); ctx.fill();
    const face = ctx.createLinearGradient(-radius * .8, -radius, radius * .8, radius); face.addColorStop(0, '#ffedbd'); face.addColorStop(.42, '#eed294'); face.addColorStop(1, '#c49a58'); ctx.fillStyle = face; this.octagon(ctx, radius, -1); ctx.fill();
    ctx.strokeStyle = '#845a2c'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.strokeStyle = '#fff0c3a6'; ctx.lineWidth = 1; this.octagon(ctx, radius - 3, -1); ctx.stroke();
    ctx.strokeStyle = s.side ? '#9e352d73' : '#28577973'; ctx.lineWidth = Math.max(1, radius * .035); this.octagon(ctx, radius * .78, -1); ctx.stroke();
    for (let i = 0; i < 5; i++) { const y = -radius * .55 + i * radius * .25; ctx.strokeStyle = '#9f6d3520'; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(-radius * .65, y); ctx.lineTo(radius * .65, y + radius * .05); ctx.stroke(); }
    ctx.font = `700 ${Math.round(radius * 1.23)}px "Noto Serif KR", "Noto Serif CJK KR", Batang, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = spec.label[s.side]; ctx.fillStyle = '#fff0c38c'; ctx.fillText(label, .6, 1); ctx.fillStyle = s.side ? '#a1372b' : '#234e72'; ctx.fillText(label, 0, 0);
    ctx.restore();
  }
  /** A moving, bounded silhouette carries the launch cue to the first contact. */
  private powerWake(s: StoneState): void {
    const speed = Math.hypot(s.vx, s.vy);
    if (speed < 2) return;
    const ctx = this.ctx, p = project(s.x, s.y), radius = pieceSpec(s.kind).radius * SCALE;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(s.vy, s.vx));
    ctx.globalAlpha = Math.min(.8, (speed - 2) / 9);
    // Two short tapered streaks frame the wood; no glow over the character.
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#49321e'; ctx.beginPath();
      ctx.moveTo(-radius * 2.6, side * radius * .78);
      ctx.lineTo(-radius * .25, side * radius * 1.04);
      ctx.lineTo(-radius * .55, side * radius * .86); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ffe6ac'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(-radius * 1.9, side * radius * .85);
      ctx.lineTo(-radius * .2, side * radius * 1.02); ctx.stroke();
    }
    ctx.restore();
  }
  private powerStroke(s: PowerStroke): void {
    const ctx = this.ctx, t = s.age / .19;
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.atan2(s.ny, s.nx));
    ctx.globalAlpha = Math.pow(1 - t, 1.7);
    // Three directional brush marks stay close to the launch stone.
    const reach = 54 + s.power * 48, drift = t * 38;
    for (const side of [-1, 0, 1]) {
      ctx.strokeStyle = side === 0 ? '#33271ed9' : '#59402caa';
      ctx.lineWidth = side === 0 ? 7 : 2.5; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(-reach + drift, side * 15); ctx.lineTo(32 + drift, side * 8); ctx.stroke();
    }
    ctx.strokeStyle = '#ffe0a0'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(-reach * .7 + drift, -3); ctx.lineTo(40 + drift, -3); ctx.stroke();
    ctx.restore();
  }
  private flash(f: Flash): void {
    if (f.powered) this.powerSeal(f);
    const ctx = this.ctx, p = Math.min(1, f.age / (.075 + f.strength * .065 + (f.powered ? .075 : 0)));
    const weight = Math.min(1.35, .7 + f.mass * .23), span = (3 + f.strength * 12) * weight;
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(Math.atan2(f.ny, f.nx));
    ctx.globalAlpha = Math.pow(Math.max(0, 1 - p), 1.6) * (.35 + f.strength * .65);
    // A thin dark impression, immediately followed by a light contact edge:
    // a tap stays a dot; a heavy collision briefly shows the shared hard edge.
    ctx.strokeStyle = '#56351f'; ctx.lineWidth = 2 + f.strength * 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -span); ctx.lineTo(0, span); ctx.stroke();
    ctx.strokeStyle = f.metal ? '#fff3d1' : '#fff0ca'; ctx.lineWidth = 1 + f.strength * 1.2;
    ctx.beginPath(); ctx.moveTo(-1.5, -span * .88); ctx.lineTo(-1.5, span * .88); ctx.stroke();
    if (f.strength > .34) {
      const separation = 3 + p * 14 * f.strength, extension = (4 + f.strength * 10) * weight;
      ctx.lineWidth = f.metal ? 1.7 : 1.4;
      // Two compact chips along the contact tangent, never a radial burst.
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(-separation * .25, side * (span + separation));
        ctx.lineTo(-separation * .6, side * (span + separation + extension)); ctx.stroke();
      }
      if (f.strength > .65 && p < .5) {
        ctx.strokeStyle = '#624127'; ctx.lineWidth = 1.3; ctx.beginPath();
        ctx.moveTo(-4 - p * 5, -span * .45); ctx.lineTo(-4 - p * 5, span * .45); ctx.stroke();
      }
    }
    if (f.powered) {
      // A broad contact bracket opens along the transfer direction, then disappears.
      // It remains attached to the actual collision, never to the whole board.
      const spread = 8 + p * 30, height = span * (1.6 - p * .35);
      ctx.globalAlpha = Math.pow(1 - p, 1.25) * (.5 + f.strength * .5);
      ctx.lineJoin = 'miter';
      for (const side of [-1, 1]) {
        ctx.strokeStyle = '#49301d'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(side * (spread + 13), -height);
        ctx.lineTo(side * spread, 0); ctx.lineTo(side * (spread + 13), height); ctx.stroke();
        ctx.strokeStyle = '#ffe6ad'; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    ctx.restore();
  }
  /** A compact red seal stays readable at phone scale without hiding either piece. */
  private powerSeal(f: Flash): void {
    const ctx = this.ctx, t = f.age / .34;
    const tx = Math.max(TABLE.x + 60, Math.min(TABLE.x + TABLE.w - 60, f.x + 83));
    const ty = Math.max(TABLE.y + 35, Math.min(TABLE.y + TABLE.h - 35, f.y - 26 - t * 10));
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(-.09);
    ctx.globalAlpha = Math.min(1, (1 - t) / .45);
    const scale = 1 + .12 * Math.max(0, 1 - t / .2); ctx.scale(scale, scale);
    ctx.fillStyle = '#842e20'; ctx.fillRect(-48, -25, 96, 50);
    ctx.strokeStyle = '#f6d59b'; ctx.lineWidth = 2; ctx.strokeRect(-44, -21, 88, 42);
    ctx.fillStyle = '#ffebbd'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 30px "Noto Serif KR", "Noto Serif CJK KR", serif';
    ctx.fillText('강타', 0, 1);
    ctx.restore();
  }
  private paintBoard(ctx: CanvasRenderingContext2D): void {
    const b = TABLE;
    ctx.save(); ctx.shadowColor = '#120a0599'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 13; ctx.fillStyle = '#674127'; ctx.fillRect(b.x - 6, b.y + 7, b.w + 12, b.h + 8); ctx.restore();
    const wood = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h); wood.addColorStop(0, '#d5a76b'); wood.addColorStop(.5, '#c9965c'); wood.addColorStop(1, '#b97e44'); ctx.fillStyle = wood; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
    for (let n = 0; n < 310; n++) { const y = b.y + random(n + 9) * b.h; ctx.strokeStyle = `rgba(${n % 4 ? '97,55,22' : '255,231,184'},${random(n + 12) * .065 + .014})`; ctx.lineWidth = random(n + 89) * 1.1 + .35; ctx.beginPath(); ctx.moveTo(b.x, y); for (let x = b.x; x < b.x + b.w + 30; x += 45) ctx.lineTo(x, y + Math.sin(x * .011 + n) * 3); ctx.stroke(); }
    // Korean janggi has nine files, ten ranks, and palaces at both ends. No river.
    ctx.strokeStyle = '#543a245f'; ctx.lineWidth = 1.65;
    for (let file = 0; file < 9; file++) { const a = project(.5 + file, .5), z = project(.5 + file, 9.5); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y); ctx.stroke(); }
    for (let rank = 0; rank < 10; rank++) { const a = project(.5, .5 + rank), z = project(8.5, .5 + rank); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y); ctx.stroke(); }
    for (const y of [.5, 7.5]) for (const invert of [false, true]) { const a = project(3.5, invert ? y + 2 : y), z = project(5.5, invert ? y : y + 2); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y); ctx.stroke(); }
    // Small corner marks at cannon and soldier starting intersections.
    ctx.strokeStyle = '#61442c6b'; ctx.lineWidth = 1.35;
    for (const row of [2.5, 3.5, 6.5, 7.5]) for (const x of row === 2.5 || row === 7.5 ? [1.5, 7.5] : [.5, 2.5, 4.5, 6.5, 8.5]) {
      const p = project(x, row); for (const sx of [-1, 1]) for (const sy of [-1, 1]) { if ((x === .5 && sx < 0) || (x === 8.5 && sx > 0)) continue; ctx.beginPath(); ctx.moveTo(p.x + sx * 7, p.y + sy * 18); ctx.lineTo(p.x + sx * 7, p.y + sy * 7); ctx.lineTo(p.x + sx * 18, p.y + sy * 7); ctx.stroke(); }
    }
    const middle = project(0, 5).y;
    ctx.fillStyle = '#4b2e1a33'; ctx.fillRect(b.x, middle - 1.5, b.w, 3); ctx.fillStyle = '#f7d39788'; ctx.fillRect(b.x, middle + 1.5, b.w, 1.4);
    // The fold is only a seam. The two metal hinges are the short physical barriers.
    ctx.restore();
    ctx.strokeStyle = '#f4d29c9c'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2); ctx.strokeStyle = '#6d452b99'; ctx.lineWidth = 1.5; ctx.strokeRect(b.x + 9, b.y + 9, b.w - 18, b.h - 18);
    for (const hinge of HINGES) {
      const p = project(hinge.x, hinge.y), w = hinge.halfWidth * SCALE * 2, h = hinge.halfHeight * SCALE * 2;
      ctx.save(); ctx.translate(p.x, p.y); ctx.shadowColor = '#3e291b73'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 3; ctx.fillStyle = '#6b6b5f'; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.shadowColor = 'transparent';
      const metal = ctx.createLinearGradient(0, -h / 2, 0, h / 2); metal.addColorStop(0, '#b2ab8a'); metal.addColorStop(.42, '#d1c8a4'); metal.addColorStop(.5, '#6e705f'); metal.addColorStop(.65, '#a29c7b'); metal.addColorStop(1, '#777965'); ctx.fillStyle = metal; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = '#4b5147'; ctx.lineWidth = 1; ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.strokeStyle = '#f0e0ac66'; ctx.strokeRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
      for (const x of [-w * .32, w * .32]) for (const y of [-h * .26, h * .26]) { ctx.fillStyle = '#676b5a'; ctx.beginPath(); ctx.arc(x, y, 2.7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#d9cfa8'; ctx.beginPath(); ctx.moveTo(x - 1.5, y + 1); ctx.lineTo(x + 1.5, y - 1); ctx.stroke(); }
      ctx.restore();
    }
    ctx.fillStyle = '#78532f'; ctx.font = '13px serif'; ctx.textAlign = 'right'; ctx.fillText('방과 후 · 장기 알까기', b.x + b.w - 20, b.y + b.h - 19);
  }
}
