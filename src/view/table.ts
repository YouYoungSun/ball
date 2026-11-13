import { RULES } from '../core/rules.ts';
import type { GameEvent, MatchState, StoneState } from '../core/types.ts';
export const TABLE = { x: 150, y: 68, w: 800, h: 520, width: 1100, height: 690 };
interface Flash { x: number; y: number; age: number; strength: number }
interface Falling { stone: StoneState; age: number }
export interface Aim { stoneId: number; x: number; y: number }
const random = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

/** All clocks and randomness in this class affect presentation only. */
export class TableView {
  shaking = true;
  effects = true;
  private ctx: CanvasRenderingContext2D;
  private backdrop: HTMLCanvasElement;
  private flashes: Flash[] = [];
  private falls: Falling[] = [];
  private trails = new Map<number, Array<{ x: number; y: number }>>();
  private impact = 0;
  private age = 0;
  private canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d')!;
    this.backdrop = document.createElement('canvas'); this.backdrop.width = TABLE.width; this.backdrop.height = TABLE.height;
    this.paintBoard(this.backdrop.getContext('2d')!);
  }
  clear(): void { this.flashes = []; this.falls = []; this.trails.clear(); this.impact = 0; }
  receive(events: GameEvent[], previous: MatchState): void {
    for (const e of events) {
      if (e.kind === 'hit') { this.flashes.push({ x: TABLE.x + e.x * 100, y: TABLE.y + e.y * 100, age: 0, strength: e.strength }); this.impact = Math.max(this.impact, e.strength * 7); }
      if (e.kind === 'removed') {
        const stone = previous.stones.find(s => s.id === e.stoneId)!;
        this.falls.push({ stone: { ...stone, x: e.x, y: e.y, vx: e.vx, vy: e.vy }, age: 0 });
        this.trails.delete(e.stoneId);
      }
    }
  }
  render(state: MatchState, dt: number, selected: number | null, aim: Aim | null, previous?: MatchState, alpha = 1): void {
    const ctx = this.ctx; this.age += dt;
    this.flashes.forEach(f => f.age += dt); this.falls.forEach(f => f.age += dt);
    this.flashes = this.flashes.filter(f => f.age < .32); this.falls = this.falls.filter(f => f.age < .7);
    this.impact *= Math.exp(-26 * dt);
    ctx.clearRect(0, 0, TABLE.width, TABLE.height); ctx.save();
    if (this.shaking && this.effects) ctx.translate(Math.sin(this.age * 180) * this.impact, Math.cos(this.age * 145) * this.impact * .6);
    ctx.drawImage(this.backdrop, 0, 0);
    const stones = state.stones.filter(s => s.alive).map(s => {
      const old = previous?.stones.find(o => o.id === s.id);
      return old?.alive ? { ...s, x: old.x + (s.x - old.x) * alpha, y: old.y + (s.y - old.y) * alpha } : s;
    });
    for (const s of stones) {
      const speed = Math.hypot(s.vx, s.vy);
      let trail = this.trails.get(s.id) ?? []; this.trails.set(s.id, trail);
      if (dt > 0) { if (speed > 2) { trail.unshift({ x: s.x, y: s.y }); if (trail.length > 7) trail.pop(); } else trail.pop(); }
      if (this.effects && trail.length > 1) {
        ctx.save(); ctx.globalAlpha = .12; ctx.strokeStyle = s.side ? '#fff3d5' : '#292d23'; ctx.lineWidth = 30; ctx.lineCap = 'round'; ctx.beginPath();
        trail.forEach((p, i) => i ? ctx.lineTo(TABLE.x + p.x * 100, TABLE.y + p.y * 100) : ctx.moveTo(TABLE.x + p.x * 100, TABLE.y + p.y * 100)); ctx.stroke(); ctx.restore();
      }
    }
    for (const s of stones.sort((a, b) => a.y - b.y)) this.stone(s);
    for (const f of this.falls) this.stone({ ...f.stone, x: f.stone.x + f.stone.vx * f.age * .12, y: f.stone.y + f.stone.vy * f.age * .12 }, f.age / .7);
    if (state.phase === 'aiming' && selected !== null) {
      const s = stones.find(s => s.id === selected);
      if (s) this.drawAim(s, aim);
    }
    if (this.effects) for (const f of this.flashes) {
      const p = f.age / .32; ctx.save(); ctx.translate(f.x, f.y); ctx.globalAlpha = Math.max(0, 1 - p * 1.5) * f.strength; ctx.strokeStyle = '#fff5cf';
      for (let i = 0; i < 9; i++) {
        const a = i * Math.PI * 2 / 9, start = 7 + p * 16, end = start + (12 + random(i + 1) * 22) * f.strength;
        ctx.lineWidth = i % 3 ? 1.4 : 2.8; ctx.beginPath(); ctx.moveTo(Math.cos(a) * start, Math.sin(a) * start); ctx.lineTo(Math.cos(a) * end, Math.sin(a) * end); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  point(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width * TABLE.width - TABLE.x) / 100,
      y: ((clientY - r.top) / r.height * TABLE.height - TABLE.y) / 100 };
  }
  private drawAim(s: StoneState, aim: Aim | null): void {
    const ctx = this.ctx, x = TABLE.x + s.x * 100, y = TABLE.y + s.y * 100;
    ctx.save(); ctx.strokeStyle = '#e6ca98'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.arc(x, y, 37, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    if (aim) {
      const dx = s.x - aim.x, dy = s.y - aim.y, length = Math.hypot(dx, dy) || 1, angle = Math.atan2(dy, dx), p = Math.min(1, length / 1.6);
      ctx.strokeStyle = '#655034'; ctx.lineWidth = 2; ctx.setLineDash([4, 7]); ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * 40, y + Math.sin(angle) * 40); ctx.lineTo(x + Math.cos(angle) * (80 + p * 80), y + Math.sin(angle) * (80 + p * 80)); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#9b3525'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 39, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#f0d9ae'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${Math.round(p * 100)}%`, x, y + 62);
    }
    ctx.restore();
  }
  private stone(s: StoneState, fall = 0): void {
    const ctx = this.ctx, x = TABLE.x + s.x * 100, y = TABLE.y + s.y * 100;
    ctx.save(); ctx.globalAlpha = 1 - fall; ctx.fillStyle = '#1f110747'; ctx.beginPath(); ctx.ellipse(x + 9, y + 12, 30 * (1 - fall), 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(x, y + fall * fall * 140); ctx.scale(1 - fall * .7, 1 - fall * .7); ctx.rotate(fall * 3);
    const grad = ctx.createRadialGradient(-10, -13, 2, 2, 2, 33);
    for (const [at, color] of s.side ? [[0, '#fffdf0'], [.5, '#eae6d9'], [.85, '#c9c4b6'], [1, '#9e9a8e']] as const
      : [[0, '#666961'], [.3, '#343a34'], [.7, '#171d19'], [1, '#080e0a']] as const) grad.addColorStop(at, color);
    ctx.fillStyle = grad; ctx.beginPath(); ctx.ellipse(0, 2, RULES.radius * 100, RULES.radius * 89.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = s.side ? '#a8a492' : '#0c100d'; ctx.lineWidth = 1.3; ctx.stroke(); ctx.fillStyle = s.side ? '#ffffff99' : '#ffffff29'; ctx.beginPath(); ctx.ellipse(-9, -10, 8, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  private paintBoard(ctx: CanvasRenderingContext2D): void {
    const b = TABLE;
    ctx.save(); ctx.shadowColor = '#00000080'; ctx.shadowBlur = 35; ctx.shadowOffsetY = 22; ctx.fillStyle = '#603e24'; ctx.fillRect(b.x - 8, b.y + 8, b.w + 16, b.h + 20); ctx.restore();
    const wood = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
    [[0, '#d3a16a'], [.3, '#c58c51'], [.65, '#bc8148'], [1, '#ab703e']].forEach(([p, color]) => wood.addColorStop(p as number, color as string));
    ctx.fillStyle = wood; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
    for (let n = 0; n < 220; n++) {
      const y = b.y + random(n + 9) * b.h; ctx.strokeStyle = `rgba(${n % 3 ? '87,46,19' : '255,222,167'},${random(n + 12) * .09 + .015})`;
      ctx.lineWidth = random(n + 89) * 1.2 + .3; ctx.beginPath(); ctx.moveTo(b.x, y);
      for (let x = b.x; x < b.x + b.w + 20; x += 35) ctx.lineTo(x, y + Math.sin(x * .012 + n) * 4 + Math.sin(x * .038 + n * 2) * 1.4); ctx.stroke();
    }
    ctx.strokeStyle = '#39291747'; ctx.lineWidth = 1;
    for (let i = 0; i < 13; i++) { const x = b.x + 36 + i * (b.w - 72) / 12; ctx.beginPath(); ctx.moveTo(x, b.y + 34); ctx.lineTo(x, b.y + b.h - 34); ctx.stroke(); }
    for (let i = 0; i < 9; i++) { const y = b.y + 34 + i * (b.h - 68) / 8; ctx.beginPath(); ctx.moveTo(b.x + 36, y); ctx.lineTo(b.x + b.w - 36, y); ctx.stroke(); }
    for (const [x, y] of [[370, 210], [730, 210], [550, 328], [370, 445], [730, 445]]) { ctx.fillStyle = '#655031'; ctx.beginPath(); ctx.arc(x, y, 3.3, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore(); ctx.strokeStyle = '#ffe3af73'; ctx.strokeRect(b.x + .5, b.y + .5, b.w - 1, b.h - 1);
    ctx.fillStyle = '#795330'; ctx.font = '12px serif'; ctx.fillText('방과 후', b.x + 18, b.y + b.h - 15);
    ctx.save(); ctx.translate(100, 270); ctx.rotate(-.1); ctx.fillStyle = '#d2ba8b'; ctx.fillRect(-28, -30, 54, 98); ctx.fillStyle = '#4b3c28'; ctx.font = '15px serif'; ctx.fillText('한', -8, -7); ctx.fillText('수', -8, 20); ctx.restore();
    ctx.save(); ctx.translate(979, 420); ctx.rotate(.08); ctx.strokeStyle = '#9d3425'; ctx.lineWidth = 2; ctx.strokeRect(-17, -30, 34, 64); ctx.fillStyle = '#9d3425'; ctx.font = '19px serif'; ctx.fillText('결', -10, -6); ctx.fillText('투', -10, 20); ctx.restore();
  }
}
