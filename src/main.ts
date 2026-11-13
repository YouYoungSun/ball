import './style.css';
import { Game, initPhysics, makeShot } from './core/game.ts';
import { RULES, PIECES, maxImpulseFor, pieceSpec } from './core/rules.ts';
import type { MatchState, ShotCommand } from './core/types.ts';
import { AudioPlayer } from './audio/audio.ts';
import { TableView, TABLE } from './view/table.ts';
import type { Aim } from './view/table.ts';
import { OnlineClient } from './net/online.ts';
import type { ConnectionStatus } from './net/online.ts';
import type { RoomInfo } from './net/protocol.ts';
import type { Side } from './core/types.ts';
import type { Difficulty } from './players/ai.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<main>
  <header><h1>장기 알까기 <small>크기가 곧 무게다.</small></h1><div class="score" aria-label="진영과 남은 알"><span class="team-cho">초 · 아래 <b id="black-stones">16</b></span><span class="team-han">한 · 위 <b id="white-stones">16</b></span></div></header>
  <div class="scene"><canvas id="game" tabindex="0" aria-label="위는 한, 아래는 초 진영인 장기판. 내 장기알을 뒤로 당겨 발사하세요. 양쪽 중앙의 금속 경첩은 작은 벽입니다."></canvas><div class="result" id="result" role="status" hidden></div></div>
  <footer><div><p class="status" id="status" aria-live="polite">판을 준비하고 있어요.</p><p class="selected-info" id="selected-info"></p></div><div class="actions"><button id="power" aria-pressed="false" disabled>파죽지세 · 1회</button><button class="new" id="restart" disabled>다시 한 판</button><button id="pause" disabled>잠깐 쉬기</button><button id="sound" aria-pressed="true">소리 켜짐</button><button id="shake" aria-pressed="true">흔들림 켜짐</button></div></footer>
  <div class="settings"><label>대전 <select id="mode" aria-label="대전 방식"><option value="solo">혼자 하기</option><option value="local">한 기기 둘이서</option><option value="online">온라인 대전</option></select></label><label id="difficulty-label">상대 <select id="difficulty" aria-label="AI 난이도"><option value="easy">가볍게</option><option value="normal" selected>보통</option><option value="hard">만만치 않게</option></select></label></div>
  <section class="online-panel" id="online-panel" aria-label="온라인 대전" hidden>
    <div class="online-heading"><strong>친구와 한 판</strong><span id="connection" role="status">연결 전</span></div>
    <p>로그인 없이 방을 만들고 초대 링크나 방 코드를 보내세요.</p>
    <div class="online-controls"><button id="create-room">방 만들기</button><label>방 코드 <input id="room-code" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="코드 입력" /></label><button id="join-room">입장</button></div>
    <div id="room-info" hidden><p id="room-label"></p><div class="online-controls"><input id="invite-link" readonly aria-label="초대 링크" /><button id="copy-invite">초대 링크 복사</button><button id="ready">준비</button><button id="leave-room">방 나가기</button></div><p id="room-status" aria-live="polite"></p></div>
    <p id="online-notice" aria-live="polite"></p>
  </section>
  <details><summary>어떻게 두나요?</summary><p>아래 청색 초와 위 홍색 한이 번갈아 장기알을 튕깁니다. 내 알을 뒤로 당겨 놓으세요. 큰 알일수록 무겁고, 작은 알로 큰 알을 맞히면 덜 밀리고 되튈 수 있습니다. 가장자리나 다른 알을 이용해 공략해 보세요.</p><p>가운데 접힌 선 안쪽의 금속 경첩 두 개는 작은 벽입니다. 중앙은 통과할 수 있고, 경첩에 맞으면 튕겨 나갑니다. 모든 알이 멈추면 차례가 바뀝니다. 왕도 하나의 알이며 상대 알을 모두 판 밖으로 보내면 승리합니다. 200수 안에 승부가 나지 않으면 무승부입니다. 파죽지세는 각 진영이 한 경기에 한 번, 더 강하게 발사하는 기술입니다. 버튼을 누르고 발사하면 사용되며 발사 전에는 취소할 수 있습니다.</p><p>키보드: 판을 선택한 뒤 Q/E로 내 알을 차례로 선택, 숫자 1~9로 빠른 선택, ← → 방향, ↑ ↓ 힘, Enter로 발사합니다. Escape로 조준을 취소합니다.</p></details></main>`;
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const canvas = element<HTMLCanvasElement>('game'), status = element('status'), result = element('result');
const modeSelect = element<HTMLSelectElement>('mode'), difficultySelect = element<HTMLSelectElement>('difficulty');
canvas.width = TABLE.width; canvas.height = TABLE.height;
const view = new TableView(canvas), audio = new AudioPlayer(); audio.enabled = true;
view.shaking = !matchMedia('(prefers-reduced-motion: reduce)').matches;
element('shake').setAttribute('aria-pressed', String(view.shaking)); element('shake').textContent = view.shaking ? '흔들림 켜짐' : '흔들림 꺼짐';
let game: Game, state: MatchState, previous: MatchState, worker: Worker | null = null;
let requestId = 0, thinking = false, pendingAI: ShotCommand | null = null, paused = false, hidden = document.hidden;
let powerArmed = false, shotPending = false;
let selected: number | null = null, aim: Aim | null = null, keyboardAngle = 0, keyboardPower = .65;
let accumulator = 0, last = 0, matchNumber = 0, hudKey = '';
let online: OnlineClient | null = null, connectionStatus: ConnectionStatus = 'disconnected';
let roomCode = '', roomSide: Side | null = null, room: RoomInfo | null = null;
let resultAfter = 0, onlineArrivedAt = 0, onlineFrameSpan = .05;
const onlineNotice = (message: string) => { element('online-notice').textContent = message; };
function onlineCanPlay(): boolean {
  return connectionStatus === 'connected' && room?.status === 'playing' && room.connected.every(Boolean) && roomSide === state.side && !shotPending;
}
function onlineGameStatus(): string {
  if (connectionStatus === 'reconnecting') return '연결 복구 중입니다. 다시 연결되면 서버의 현재 판으로 이어집니다.';
  if (!roomCode) return '방을 만들거나 초대받은 방 코드로 입장하세요.';
  if (!room?.connected.every(Boolean)) return '상대의 연결을 기다리고 있어요.';
  if (room.status === 'waiting') return '두 사람 모두 준비를 누르면 시작합니다.';
  if (shotPending) return '서버에서 발사를 확인하고 있어요.';
  return '상대의 차례입니다.';
}
function updateRoom(): void {
  element('connection').textContent = ({ connecting: '연결 중', connected: '서버 연결됨', reconnecting: '재연결 중', disconnected: '연결 전' })[connectionStatus];
  element('room-info').hidden = !roomCode;
  element('room-label').textContent = `방 ${roomCode} · 내 진영: ${roomSide === 0 ? '아래 초' : '위 한'}`;
  const invite = new URL(location.href); invite.searchParams.set('room', roomCode);
  element<HTMLInputElement>('invite-link').value = roomCode ? invite.href : '';
  const ready = element<HTMLButtonElement>('ready');
  ready.disabled = !room || room.status !== 'waiting' || connectionStatus !== 'connected' || (roomSide !== null && room.ready[roomSide]);
  ready.textContent = roomSide !== null && room?.ready[roomSide] ? '준비 완료' : '준비';
  element('room-status').textContent = room?.status === 'finished'
    ? `재대결: 초 ${room.rematch[0] ? '요청 완료' : '대기'} · 한 ${room.rematch[1] ? '요청 완료' : '대기'}`
    : room ? `초 ${room.connected[0] ? room.ready[0] ? '준비 완료' : '참가 중' : '연결 대기'} · 한 ${room.connected[1] ? room.ready[1] ? '준비 완료' : '참가 중' : '연결 대기'}` : '방 정보를 기다리고 있어요.';
  element<HTMLButtonElement>('create-room').disabled = !!roomCode;
  element<HTMLButtonElement>('join-room').disabled = !!roomCode;
  hudKey = ''; if (state) updateHUD();
}
function connectOnline(): OnlineClient | null {
  if (online) return online;
  const configured = import.meta.env.VITE_GAME_SERVER_URL as string | undefined;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!configured && !local) { onlineNotice('온라인 서버가 설정되지 않았습니다. 배포 환경에 VITE_GAME_SERVER_URL을 설정해 주세요. 혼자 하기와 한 기기 대전은 바로 이용할 수 있습니다.'); return null; }
  const url = configured || 'ws://localhost:8787';
  try { const parsed = new URL(url); if (!['ws:', 'wss:'].includes(parsed.protocol)) throw new Error(); }
  catch { onlineNotice('온라인 서버 주소가 올바르지 않습니다. ws:// 또는 wss:// 주소를 설정해 주세요.'); return null; }
  if (location.protocol === 'https:' && url.startsWith('ws:')) { onlineNotice('HTTPS에서는 보안 연결인 wss:// 온라인 서버 주소가 필요합니다.'); return null; }
  online = new OnlineClient(url);
  online.onStatus(value => { connectionStatus = value; if (value !== 'connected') { aim = null; shotPending = false; } updateRoom(); });
  online.onMessage(message => {
    if (!isOnline()) return;
    if (message.kind === 'session') { roomCode = message.code; roomSide = message.side; const url = new URL(location.href); url.searchParams.set('room', roomCode); history.replaceState(null, '', url); onlineNotice('초대 링크를 공유하고 두 사람 모두 준비를 눌러 주세요.'); }
    if (message.kind === 'room') room = message.room;
    if (message.kind === 'error') { shotPending = false; onlineNotice(message.message); if (message.code === 'session-expired') { roomCode = ''; roomSide = null; room = null; } }
    if (message.kind === 'ack') { shotPending = false; if (message.result.accepted) powerArmed = false; else onlineNotice(message.result.reason); }
    if (message.kind === 'state') {
      const changed = state.matchId !== message.state.matchId;
      if (changed || message.snapshot) { view.clear(); audio.reset(); powerArmed = false; shotPending = false; }
      previous = state; state = message.state;
      onlineArrivedAt = performance.now(); onlineFrameSpan = Math.max(RULES.dt, Math.min(.15, (state.tick - previous.tick) * RULES.dt));
      if (changed || message.snapshot) previous = state;
      if (state.phase === 'finished' && previous.phase !== 'finished') resultAfter = performance.now() + 550;
      if (changed) resultAfter = state.phase === 'finished' ? performance.now() + 550 : 0;
      if (!message.snapshot && !hidden) { const events = message.events.map(item => item.event); view.receive(events, state); events.forEach(event => audio.event(event, state)); }
      if (state.phase !== 'aiming' || roomSide !== state.side) { selected = null; aim = null; powerArmed = false; }
      else if (selected === null || !state.stones.some(stone => stone.id === selected && stone.alive && stone.side === roomSide)) selected = preferredStone();
    }
    updateRoom();
  });
  online.connect(); return online;
}
function disconnectOnline(): void {
  const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url);
  online?.leave(); online?.close(); online = null; roomCode = ''; roomSide = null; room = null; connectionStatus = 'disconnected'; shotPending = false; powerArmed = false; view.clear(); audio.reset(); updateRoom();
}
const humanShotId = () => `human-${crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('')}`;
const isOnline = () => modeSelect.value === 'online';
const isHuman = () => state && state.phase === 'aiming' && !paused && !hidden && (isOnline() ? onlineCanPlay() : modeSelect.value === 'local' || state.side === 0);
function updateHUD(): void {
  const key = `${state.turn}/${state.phase}/${state.winner}/${thinking}/${paused}/${selected}/${powerArmed}/${state.skillUsed?.join(',')}/${shotPending}/${state.stones.map(s => s.alive ? '1' : '0').join('')}`;
  if (hudKey === key) return; hudKey = key;
  for (const side of [0, 1] as const) {
    const stones = state.stones.filter(s => s.side === side);
    element(side ? 'white-stones' : 'black-stones').textContent = String(stones.filter(s => s.alive).length);
  }
  const power = element<HTMLButtonElement>('power');
  const used = state.skillUsed?.[isOnline() ? roomSide ?? state.side : state.side] ?? false;
  power.disabled = !isHuman() || used;
  power.textContent = used ? '파죽지세 · 사용 완료' : powerArmed ? '파죽지세 · 발사 대기' : '파죽지세 · 1회';
  power.setAttribute('aria-pressed', String(powerArmed));
  const picked = state.stones.find(s => s.id === selected && s.alive);
  element('selected-info').textContent = picked ? `${picked.side === 0 ? '초' : '한'}의 ${pieceSpec(picked.kind).name} · 상대 무게 ${(pieceSpec(picked.kind).mass / PIECES.soldier.mass).toFixed(1)} · 뒤로 당겼다 놓으세요.` : '';
  result.hidden = state.phase !== 'finished' || performance.now() < resultAfter || (isOnline() && !roomCode);
  element<HTMLButtonElement>('pause').disabled = isOnline();
  element('restart').textContent = isOnline() ? '재대결 요청' : '다시 한 판';
  element<HTMLButtonElement>('restart').disabled = isOnline() && (!roomCode || state.phase !== 'finished');
  if (state.phase === 'finished') {
    const label = state.winner === 'draw' ? '무승부' : modeSelect.value === 'solo' ? state.winner === 0 ? '초의 승리' : '한의 승리' : state.winner === 0 ? '초의 승리' : '한의 승리';
    result.innerHTML = `${label}<small>한 판 더 둘까요?</small>`; status.textContent = '승부가 끝났습니다.';
  } else if (isOnline() && !onlineCanPlay() && state.phase !== 'moving') status.textContent = onlineGameStatus();
  else if (paused) status.textContent = '잠깐 쉬는 중입니다.';
  else if (thinking) status.textContent = '상대가 한 수를 고르고 있어요.';
  else if (state.phase === 'moving') status.textContent = '돌이 멈출 때까지…';
  else status.textContent = `${state.turn}수 · ${state.side === 0 ? '아래 초' : '위 한'}의 차례`;
}
function preferredStone(): number | null {
  const mine = state.stones.filter(s => s.alive && s.side === state.side);
  return [...mine].sort((a, b) => (a.kind === 'soldier' ? 0 : 10) + Math.abs(a.x - RULES.width / 2) - (b.kind === 'soldier' ? 0 : 10) - Math.abs(b.x - RULES.width / 2))[0]?.id ?? null;
}
function consume(): void {
  const events = game.drainEvents();
  if (events.some(e => e.kind === 'match-ended')) resultAfter = performance.now() + 550; view.receive(events, state); events.forEach(e => audio.event(e, state));
  previous = state; state = game.state();
  if (state.phase !== 'aiming') { selected = null; aim = null; }
  else if (selected === null || !state.stones.some(s => s.id === selected && s.alive && s.side === state.side)) selected = preferredStone();
  updateHUD();
}
function submit(command: ShotCommand): void {
  if (powerArmed && command.side === state.side) command = { ...command, skill: 'power' };
  if (isOnline()) {
    if (!onlineCanPlay()) return;
    shotPending = true; aim = null; online?.shoot(command); hudKey = ''; updateHUD(); return;
  }
  const answer = game.shoot(command);
  if (!answer.accepted) { status.textContent = answer.reason; return; }
  powerArmed = false; aim = null; consume();
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
  const force = maxImpulseFor(a.kind) - 2;
  return makeShot(state, a.id, dx / n * force, dy / n * force, `fallback-${state.turn}`);
}
function scheduleAI(): void {
  if (modeSelect.value !== 'solo' || state.phase !== 'aiming' || state.side !== 1 || thinking || paused || hidden || pendingAI) return;
  thinking = true; updateHUD();
  try { ensureWorker().postMessage({ requestId: ++requestId, snapshot: game.snapshot(), difficulty: difficultySelect.value as Difficulty }); }
  catch { thinking = false; const c = fallbackAI(); if (c) submit(c); }
}
function newMatch(): void {
  powerArmed = false; shotPending = false; resultAfter = 0; audio.reset();
  worker?.terminate(); worker = null; requestId++; thinking = false; pendingAI = null; paused = false; accumulator = 0;
  game?.free(); game = new Game(`match-${++matchNumber}`); state = game.state(); previous = state;
  selected = preferredStone(); aim = null; hudKey = ''; view.clear(); keyboardAngle = 0; keyboardPower = .65;
  element('pause').textContent = '잠깐 쉬기'; updateHUD();
}
canvas.onpointerdown = e => {
  if (!isHuman()) return;
  const p = view.point(e.clientX, e.clientY), padding = matchMedia('(pointer: coarse)').matches ? .30 : .12;
  const stone = state.stones.filter(s => s.alive && s.side === state.side && Math.hypot(s.x - p.x, s.y - p.y) < pieceSpec(s.kind).radius + padding).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  if (!stone) return;
  selected = stone.id; aim = { stoneId: stone.id, ...p }; canvas.setPointerCapture(e.pointerId); updateHUD(); void audio.unlock();
};
canvas.onpointermove = e => { if (aim && isHuman()) aim = { stoneId: aim.stoneId, ...view.point(e.clientX, e.clientY) }; };
canvas.onpointerup = e => {
  if (!aim || !isHuman()) { aim = null; return; }
  const stone = state.stones.find(s => s.id === aim!.stoneId)!, p = view.point(e.clientX, e.clientY);
  const dx = stone.x - p.x, dy = stone.y - p.y, length = Math.hypot(dx, dy); aim = null;
  if (length < .06) return;
  const force = Math.min(1, length / 1.6) * (maxImpulseFor(stone.kind) - 2);
  submit(makeShot(state, stone.id, dx / length * force, dy / length * force, humanShotId()));
};
canvas.onpointercancel = () => { aim = null; };
canvas.onkeydown = e => {
  if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea, [contenteditable=true]')) return;
  if (!isHuman()) return;
  const mine = state.stones.filter(s => s.alive && s.side === state.side);
  if (/^[1-9]$/.test(e.key)) selected = mine[Number(e.key) - 1]?.id ?? selected;
  if (['q', 'Q', 'e', 'E'].includes(e.key) && mine.length) { const at = mine.findIndex(s => s.id === selected); selected = mine[(at + (e.key.toLowerCase() === 'q' ? -1 : 1) + mine.length) % mine.length].id; }
  if (e.key === 'Escape') { aim = null; return; }
  if (e.key === 'ArrowLeft') keyboardAngle -= .05;
  else if (e.key === 'ArrowRight') keyboardAngle += .05;
  else if (e.key === 'ArrowUp') keyboardPower = Math.min(1, keyboardPower + .04);
  else if (e.key === 'ArrowDown') keyboardPower = Math.max(.05, keyboardPower - .04);
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); void audio.unlock(); if (selected === null) return;
    const stone = state.stones.find(s => s.id === selected)!;
    const direction = keyboardAngle + (state.side === 0 ? -Math.PI / 2 : Math.PI / 2), force = keyboardPower * (maxImpulseFor(stone.kind) - 2);
    submit(makeShot(state, selected, Math.cos(direction) * force, Math.sin(direction) * force, humanShotId())); return;
  } else if (!/^[1-9qQeE]$/.test(e.key)) return;
  e.preventDefault();
  const s = state.stones.find(s => s.id === selected); if (!s) return;
  const direction = keyboardAngle + (state.side === 0 ? -Math.PI / 2 : Math.PI / 2);
  aim = { stoneId: s.id, x: s.x - Math.cos(direction) * keyboardPower * 1.6, y: s.y - Math.sin(direction) * keyboardPower * 1.6 };
  updateHUD();
};
element('create-room').onclick = () => { connectOnline()?.createRoom(); };
element('join-room').onclick = () => {
  const code = element<HTMLInputElement>('room-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) { onlineNotice('초대받은 방 코드를 확인해 주세요.'); return; }
  connectOnline()?.joinRoom(code);
};
element('room-code').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); element('join-room').click(); } };
element('ready').onclick = () => { void audio.unlock(); online?.ready(); };
element('leave-room').onclick = () => { disconnectOnline(); newMatch(); onlineNotice('방에서 나왔습니다. 새 방을 만들거나 다른 방에 입장할 수 있어요.'); const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url); };
element('copy-invite').onclick = async () => { const input = element<HTMLInputElement>('invite-link'); try { await navigator.clipboard.writeText(input.value); onlineNotice('초대 링크를 복사했습니다.'); } catch { input.select(); onlineNotice('초대 링크를 선택했습니다. 복사해서 공유해 주세요.'); } };
element('power').onclick = () => { if (!isHuman() || state.skillUsed?.[state.side]) return; powerArmed = !powerArmed; hudKey = ''; updateHUD(); };
element('restart').onclick = () => { if (isOnline()) online?.rematch(); else newMatch(); };
element('pause').onclick = () => { paused = !paused; aim = null; accumulator = 0; previous = state; element('pause').textContent = paused ? '계속 두기' : '잠깐 쉬기'; if (!paused) void audio.unlock(); updateHUD(); };
element('sound').onclick = () => { audio.enabled = !audio.enabled; if (audio.enabled) void audio.unlock(); element('sound').setAttribute('aria-pressed', String(audio.enabled)); element('sound').textContent = audio.enabled ? '소리 켜짐' : '소리 꺼짐'; };
element('shake').onclick = () => { view.shaking = !view.shaking; element('shake').setAttribute('aria-pressed', String(view.shaking)); element('shake').textContent = view.shaking ? '흔들림 켜짐' : '흔들림 꺼짐'; };
modeSelect.onchange = () => {
  if (!isOnline()) disconnectOnline();
  element('difficulty-label').hidden = modeSelect.value !== 'solo';
  element('online-panel').hidden = !isOnline(); newMatch();
  if (isOnline()) { hudKey = ''; updateHUD(); if (!import.meta.env.VITE_GAME_SERVER_URL && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) onlineNotice('온라인 서버가 설정되지 않았습니다. 배포 환경에 VITE_GAME_SERVER_URL을 설정해 주세요.'); }
};
difficultySelect.onchange = () => { if (thinking) { worker?.terminate(); worker = null; thinking = false; requestId++; } };
document.addEventListener('visibilitychange', () => { hidden = document.hidden; last = performance.now(); accumulator = 0; aim = null; previous = state; if (hidden) audio.suspend(); else if (!paused) void audio.unlock(); });
function frame(now: number): void {
  const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
  if (state && !hidden) {
    if (resultAfter && now >= resultAfter) { resultAfter = 0; hudKey = ''; updateHUD(); }
    if (!paused && !isOnline()) {
      if (pendingAI) { const c = pendingAI; pendingAI = null; submit(c); }
      accumulator += dt;
      while (accumulator >= RULES.dt) { previous = state; game.stepFixed(); consume(); accumulator -= RULES.dt; }
      scheduleAI();
    }
    view.render(state, paused ? 0 : dt, isHuman() ? selected : null, aim, previous, isOnline() ? Math.min(1, (now - onlineArrivedAt) / (onlineFrameSpan * 1000)) : accumulator / RULES.dt);
  }
  requestAnimationFrame(frame);
}
initPhysics().then(() => { newMatch(); element<HTMLButtonElement>('restart').disabled = false; element<HTMLButtonElement>('pause').disabled = false; last = performance.now(); requestAnimationFrame(frame);
  const invitation = new URL(location.href).searchParams.get('room');
  if (invitation) { modeSelect.value = 'online'; modeSelect.onchange?.(new Event('change')); element<HTMLInputElement>('room-code').value = invitation.toUpperCase(); element('join-room').click(); }
})
  .catch(() => { status.textContent = '판을 불러오지 못했습니다. 새로고침해 주세요.'; });
