import { Game, makeShot } from '../core/game.ts';
import { maxImpulseFor, RULES } from '../core/rules.ts';
import type { GameEvent, MatchState, PieceKind, StoneSeed } from '../core/types.ts';
export interface Scenario { id: string; title: string; note: string; seeds: StoneSeed[]; direction: [number, number]; force: number }
const pair = (kind: PieceKind = 'soldier', target: PieceKind = 'soldier', x = 4.5, y = 6.6, tx = 4.5, ty = 4.2): StoneSeed[] => [
  { id: 0, side: 0, kind, x, y }, { id: 1, side: 1, kind: target, x: tx, y: ty },
];
export const scenarios: Scenario[] = [
  { id: 'central', title: '중앙 · 졸 대 졸', note: '첫 비교 장면 · 준비 → 방출 → 첫 접촉', seeds: pair(), direction: [0, -1], force: .92 },
  { id: 'edge', title: '가장자리 · 마지막 말', note: '충돌 → 낙하 → 결과 순서 확인', seeds: pair('soldier', 'soldier', 7.4, 5.8, 8, 5.15), direction: [.68, -.73], force: 1 },
  { id: 'hinge', title: '경첩 · 금속 반사', note: '경첩 접촉 후 경로와 후속 충돌 확인', seeds: pair('soldier', 'soldier', 1.8, 6.2, 1.8, 8), direction: [0, -1], force: 1 },
  { id: 'heavy', title: '무거운 차 → 가벼운 졸', note: '동일한 힘 비율에서 질량 차이 확인', seeds: pair('chariot', 'soldier'), direction: [0, -1], force: .92 },
  { id: 'light', title: '가벼운 졸 → 무거운 차', note: '피격 반응이 실제 이동을 과장하지 않는지 확인', seeds: pair('soldier', 'chariot'), direction: [0, -1], force: .92 },
];
export interface RecordedFrame { state: MatchState; events: GameEvent[] }
export interface Recording { initial: MatchState; frames: RecordedFrame[]; command: ReturnType<typeof makeShot>; signature: string }
/** Only the rules create states/events. Every renderer replays this same immutable recording. */
export function recordScenario(scenario: Scenario, power: boolean): Recording {
  const game = new Game(`lab-${scenario.id}-${power ? 'power' : 'normal'}`, scenario.seeds);
  try {
    const initial = game.state();
    const [dx, dy] = scenario.direction, length = Math.hypot(dx, dy);
    const impulse = maxImpulseFor(scenario.seeds[0].kind) * scenario.force - 2;
    const command = makeShot(initial, 0, dx / length * impulse, dy / length * impulse, 'lab-shot', power ? 'power' : undefined);
    const result = game.shoot(command);
    if (!result.accepted) throw new Error(result.reason);
    const frames: RecordedFrame[] = [{ state: game.state(), events: game.drainEvents() }];
    while (game.isMoving && frames.length <= RULES.maxShotTicks + 1) {
      game.stepFixed(); frames.push({ state: game.state(), events: game.drainEvents() });
    }
    return { initial, command, frames, signature: JSON.stringify(frames.map(frame => ({ state: frame.state, events: frame.events }))) };
  } finally { game.free(); }
}
