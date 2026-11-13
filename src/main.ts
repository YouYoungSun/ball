import './style.css';
import { Game, initPhysics, makeShot } from './core/game.ts';
import { RULES } from './core/rules.ts';
import type { MatchState, ShotCommand } from './core/types.ts';
import { AudioPlayer } from './audio/audio.ts';
import { TableView } from './view/table.ts';
import type { Aim } from './view/table.ts';
import type { Difficulty } from './players/ai.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<main>
  <header><h1>방과 후 <small>책상 위의 결투</small></h1><div class="score" aria-label="남은 돌"><span>흑 <b class="stones" id="black-stones"></b></span><span>백 <b class="stones white" id="white-stones"></b></span></div></header>
  <div class="scene"><canvas id="game" width="1100" height="690" tabindex="0" aria-label="알까기판. 내 돌을 뒤로 당겼다 놓아 발사하세요. 키보드 조작은 아래 도움말을 참고하세요."></canvas><span class="note">뒤로 당겼다가, 톡.</span><div class="result" id="result" role="status" hidden></div></div>
  <footer><p class="status" id="status" aria-live="polite">판을 준비하고 있어요.</p><div class="actions"><button class="new" id="restart" disabled>다시 한 판</button><button id="pause" disabled>잠깐 쉬기</button><button id="sound" aria-pressed="false">소리 꺼짐</button><button id="shake" aria-pressed="true">흔들림 켜짐</button></div></footer>
  <div class="settings"><label>대전 <select id="mode" aria-label="대전 방식"><option value="solo">혼자 하기</option><option value="local">한 기기 둘이서</option></select></label><label id="difficulty-label">상대 <select id="difficulty" aria-label="AI 난이도"><option value="easy">가볍게</option><option value="normal" selected>보통</option><option value="hard">만만치 않게</option></select></label></div>
  <details><summary>어떻게 두나요?</summary><p>내 돌을 골라 뒤로 당긴 뒤 놓으세요. 멀리 당길수록 강해집니다. 돌이 모두 멈추면 차례가 바뀝니다. 상대 돌을 모두 판 밖으로 보내면 승리합니다. 마지막에 양쪽 돌이 함께 사라지면 무승부입니다.</p><p>키보드: 판을 선택한 뒤 숫자 1·2·3으로 돌 선택, ← → 방향, ↑ ↓ 힘, Enter로 발사합니다. Escape로 조준을 취소합니다.</p></details>
  <p class="audio-note">현재 타격음은 임시 합성음입니다.</p></main>`;
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const canvas = element<HTMLCanvasElement>('game'), status = element('status'), result = element('result');
const modeSelect = element<HTMLSelectElement>('mode'), difficultySelect = element<HTMLSelectElement>('difficulty');
const view = new TableView(canvas), audio = new AudioPlayer();
view.shaking = !matchMedia('(prefers-reduced-motion: reduce)').matches;
element('shake').setAttribute('aria-pressed', String(view.shaking)); element('shake').textContent = view.shaking ? '흔들림 켜짐' : '흔들림 꺼짐';
let game: Game, state: MatchState, previous: MatchState, worker: Worker | null = null;
let requestId = 0, thinking = false, pendingAI: ShotCommand | null = null, paused = false, hidden = document.hidden;
let selected: number | null = null, aim: Aim | null = null, keyboardAngle = 0, keyboardPower = .65;
let accumulator = 0, last = 0, matchNumber = 0, shotNumber = 0, hudKey = '';
const isHuman = () => state && state.phase === 'aiming' && !paused && !hidden && (modeSelect.value === 'local' || state.side === 0);
function updateHUD(): void {
  const key = `${state.turn}/${state.phase}/${state.winner}/${thinking}/${paused}/${state.stones.map(s => s.alive ? '1' : '0').join('')}`;
  if (hudKey === key) return; hudKey = key;
  for (const side of [0, 1] as const) {
    const stones = state.stones.filter(s => s.side === side);
    element(side ? 'white-stones' : 'black-stones').innerHTML = stones.map(s => `<i${s.alive ? '' : ' class="out"'}></i>`).join('');
  }
  result.hidden = state.phase !== 'finished';
  if (state.phase === 'finished') {
    const label = state.winner === 'draw' ? '무승부' : modeSelect.value === 'solo' ? state.winner === 0 ? '내가 이겼다.' : '다음엔 이긴다.' : state.winner === 0 ? '흑의 승리' : '백의 승리';
    result.innerHTML = `${label}<small>한 판 더 둘까요?</small>`; status.textContent = '승부가 끝났습니다.';
  } else if (paused) status.textContent = '잠깐 쉬는 중입니다.';
  else if (thinking) status.textContent = '상대가 한 수를 고르고 있어요.';
  else if (state.phase === 'moving') status.textContent = '돌이 멈출 때까지…';
  else status.textContent = `${state.turn}수 · ${state.side === 0 ? '흑' : '백'}의 차례`;
}
function consume(): void {
  const events = game.drainEvents(); view.receive(events, state); events.forEach(e => audio.event(e));
  previous = state; state = game.state();
  if (state.phase !== 'aiming') { selected = null; aim = null; }
  else if (selected === null || !state.stones.some(s => s.id === selected && s.alive && s.side === state.side)) selected = state.stones.find(s => s.alive && s.side === state.side)?.id ?? null;
  updateHUD();
}
function submit(command: ShotCommand): void {
  const answer = game.shoot(command);
  if (!answer.accepted) { status.textContent = answer.reason; return; }
  aim = null; consume();
}
function ensureWorker(): Worker {
  if (worker) return worker;
  const generation = matchNumber;
  worker = new Worker(new URL('./players/ai.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    if (e.data.requestId !== requestId || !thinking) return;
    thinking = false;
    const command: ShotCommand | null = e.data.command ?? fallbackAI();
    if (command && command.matchId === state.matchId && command.turn === state.turn) {
      if (paused || hidden) pendingAI = command; else submit(command);
    }
    updateHUD();
  };
  worker.onerror = () => {
    if (generation !== matchNumber || !thinking) return;
    worker?.terminate(); worker = null; thinking = false;
    const command = fallbackAI(); if (command) { if (paused || hidden) pendingAI = command; else submit(command); }
    updateHUD();
  };
  return worker;
}
function fallbackAI(): ShotCommand | null {
  if (state.phase !== 'aiming' || state.side !== 1 || modeSelect.value !== 'solo') return null;
  const a = state.stones.find(s => s.alive && s.side === 1), b = state.stones.find(s => s.alive && s.side === 0);
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y, n = Math.hypot(dx, dy) || 1;
  return makeShot(state, a.id, dx / n * 11998, dy / n * 11998, `fallback-${state.turn}`);
}
function scheduleAI(): void {
  if (modeSelect.value !== 'solo' || state.phase !== 'aiming' || state.side !== 1 || thinking || paused || hidden || pendingAI) return;
  thinking = true; updateHUD();
  try { ensureWorker().postMessage({ requestId: ++requestId, snapshot: game.snapshot(), difficulty: difficultySelect.value as Difficulty }); }
  catch { thinking = false; const c = fallbackAI(); if (c) submit(c); }
}
function newMatch(): void {
  worker?.terminate(); worker = null; requestId++; thinking = false; pendingAI = null; paused = false; accumulator = 0;
  game?.free(); game = new Game(`match-${++matchNumber}`); state = game.state(); previous = state;
  selected = 1; aim = null; shotNumber = 0; hudKey = ''; view.clear(); keyboardAngle = 0; keyboardPower = .65;
  element('pause').textContent = '잠깐 쉬기'; updateHUD();
}
canvas.onpointerdown = e => {
  if (!isHuman()) return;
  const p = view.point(e.clientX, e.clientY), stone = state.stones.find(s => s.alive && s.side === state.side && Math.hypot(s.x - p.x, s.y - p.y) < .50);
  if (!stone) return;
  selected = stone.id; aim = { stoneId: stone.id, ...p }; canvas.setPointerCapture(e.pointerId); void audio.unlock();
};
canvas.onpointermove = e => { if (aim && isHuman()) aim = { stoneId: aim.stoneId, ...view.point(e.clientX, e.clientY) }; };
canvas.onpointerup = e => {
  if (!aim || !isHuman()) { aim = null; return; }
  const stone = state.stones.find(s => s.id === aim!.stoneId)!, p = view.point(e.clientX, e.clientY);
  const dx = stone.x - p.x, dy = stone.y - p.y, length = Math.hypot(dx, dy); aim = null;
  if (length < .06) return;
  const force = Math.min(1, length / 1.6) * (RULES.maxImpulse - 2);
  submit(makeShot(state, stone.id, dx / length * force, dy / length * force, `human-${++shotNumber}`));
};
canvas.onpointercancel = () => { aim = null; };
canvas.onkeydown = e => {
  if (!isHuman()) return;
  const mine = state.stones.filter(s => s.alive && s.side === state.side);
  if (['1', '2', '3'].includes(e.key)) selected = mine[Number(e.key) - 1]?.id ?? selected;
  if (e.key === 'Escape') { aim = null; return; }
  if (e.key === 'ArrowLeft') keyboardAngle -= .05;
  else if (e.key === 'ArrowRight') keyboardAngle += .05;
  else if (e.key === 'ArrowUp') keyboardPower = Math.min(1, keyboardPower + .04);
  else if (e.key === 'ArrowDown') keyboardPower = Math.max(.05, keyboardPower - .04);
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); void audio.unlock(); if (selected === null) return;
    const direction = state.side === 0 ? keyboardAngle : keyboardAngle + Math.PI, force = keyboardPower * (RULES.maxImpulse - 2);
    submit(makeShot(state, selected, Math.cos(direction) * force, Math.sin(direction) * force, `human-${++shotNumber}`)); return;
  } else if (!['1', '2', '3'].includes(e.key)) return;
  e.preventDefault();
  const s = state.stones.find(s => s.id === selected); if (!s) return;
  const direction = state.side === 0 ? keyboardAngle : keyboardAngle + Math.PI;
  aim = { stoneId: s.id, x: s.x - Math.cos(direction) * keyboardPower * 1.6, y: s.y - Math.sin(direction) * keyboardPower * 1.6 };
};
element('restart').onclick = () => newMatch();
element('pause').onclick = () => { paused = !paused; aim = null; accumulator = 0; previous = state; element('pause').textContent = paused ? '계속 두기' : '잠깐 쉬기'; if (!paused) void audio.unlock(); updateHUD(); };
element('sound').onclick = () => { audio.enabled = !audio.enabled; if (audio.enabled) void audio.unlock(); element('sound').setAttribute('aria-pressed', String(audio.enabled)); element('sound').textContent = audio.enabled ? '소리 켜짐' : '소리 꺼짐'; };
element('shake').onclick = () => { view.shaking = !view.shaking; element('shake').setAttribute('aria-pressed', String(view.shaking)); element('shake').textContent = view.shaking ? '흔들림 켜짐' : '흔들림 꺼짐'; };
modeSelect.onchange = () => { element('difficulty-label').hidden = modeSelect.value === 'local'; newMatch(); };
difficultySelect.onchange = () => { if (thinking) { worker?.terminate(); worker = null; thinking = false; requestId++; } };
document.addEventListener('visibilitychange', () => { hidden = document.hidden; last = performance.now(); accumulator = 0; aim = null; previous = state; if (hidden) audio.suspend(); else if (!paused) void audio.unlock(); });
function frame(now: number): void {
  const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
  if (state && !hidden) {
    if (!paused) {
      if (pendingAI) { const c = pendingAI; pendingAI = null; submit(c); }
      accumulator += dt;
      while (accumulator >= RULES.dt) { previous = state; game.stepFixed(); consume(); accumulator -= RULES.dt; }
      scheduleAI();
    }
    view.render(state, paused ? 0 : dt, isHuman() ? selected : null, aim, previous, accumulator / RULES.dt);
  }
  requestAnimationFrame(frame);
}
initPhysics().then(() => { newMatch(); element<HTMLButtonElement>('restart').disabled = false; element<HTMLButtonElement>('pause').disabled = false; last = performance.now(); requestAnimationFrame(frame); })
  .catch(() => { status.textContent = '판을 불러오지 못했습니다. 새로고침해 주세요.'; });
