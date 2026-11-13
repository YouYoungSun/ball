import { Game, makeShot } from '../core/game.ts';
import { RULES, maxImpulseFor, pieceSpec } from '../core/rules.ts';
import type { MatchSnapshot, ShotCommand } from '../core/types.ts';
export type Difficulty = 'easy' | 'normal' | 'hard';

/** Candidate search is a player adapter. It receives only a frozen checkpoint. */
export function chooseShot(snapshot: MatchSnapshot, difficulty: Difficulty): ShotCommand | null {
  const baseline = Game.restore(snapshot), state = baseline.state(); baseline.free();
  if (state.phase !== 'aiming') return null;
  const mine = state.stones.filter(s => s.alive && s.side === state.side);
  const targets = state.stones.filter(s => s.alive && s.side !== state.side);
  const options: ShotCommand[] = [];
  for (const a of mine) for (const b of targets) for (const offset of [0, -.10, .10]) for (const force of [1, .8, .6]) {
    const angle = Math.atan2(b.y - a.y, b.x - a.x) + offset;
    const size = maxImpulseFor(a.kind) * force - 2;
    options.push(makeShot(state, a.id, Math.cos(angle) * size, Math.sin(angle) * size, `ai-${state.turn}-${options.length}`));
  }
  const budget = difficulty === 'easy' ? 10 : difficulty === 'normal' ? 20 : 36;
  let best = -Infinity, chosen: ShotCommand | null = null;
  for (let n = 0; n < Math.min(budget, options.length); n++) {
    const candidate = options[Math.floor(n * options.length / Math.min(budget, options.length))];
    const game = Game.restore(snapshot);
    try {
    if (!game.shoot(candidate).accepted) continue;
    while (game.isMoving) game.stepFixed();
    const result = game.state();
    const own = result.stones.filter(s => s.alive && s.side === state.side);
    const enemy = result.stones.filter(s => s.alive && s.side !== state.side);
    let score = (targets.length - enemy.length) * 100 - (mine.length - own.length) * 140;
    score += (targets.reduce((n, s) => n + pieceSpec(s.kind).mass, 0) - enemy.reduce((n, s) => n + pieceSpec(s.kind).mass, 0)) * 12;
    score -= (mine.reduce((n, s) => n + pieceSpec(s.kind).mass, 0) - own.reduce((n, s) => n + pieceSpec(s.kind).mass, 0)) * 18;
    if (result.winner === state.side) score += 1000;
    if (result.winner !== null && result.winner !== state.side) score -= 1000;
    for (const s of enemy) score += Math.max(0, 1 - Math.min(s.x, RULES.width - s.x, s.y, RULES.height - s.y)) * 4;
    for (const s of own) score += Math.min(s.x, RULES.width - s.x, s.y, RULES.height - s.y) * .6;
    // If a knockout is not available, approach a target rather than stall at a distance.
    const moving = result.stones.find(s => s.id === candidate.stoneId)!;
    if (moving.alive && enemy.length) score -= Math.min(...enemy.map(s => Math.hypot(s.x - moving.x, s.y - moving.y))) * 1.4;
    if (score > best) { best = score; chosen = candidate; }
    } finally { game.free(); }
  }
  if (chosen && difficulty === 'easy') {
    const angle = (state.turn % 2 ? 1 : -1) * .065, x = chosen.impulseX, y = chosen.impulseY;
    chosen = { ...chosen, impulseX: Math.round((x * Math.cos(angle) - y * Math.sin(angle)) * .96),
      impulseY: Math.round((x * Math.sin(angle) + y * Math.cos(angle)) * .96) };
  }
  return chosen;
}
