import { initPhysics } from '../core/game.ts';
import { RULES } from '../core/rules.ts';
import { AudioPlayer } from '../audio/audio.ts';
import { TableView, TABLE } from '../view/table.ts';
import * as candidateA from '../candidates/a/index.ts';
import * as candidateB from '../candidates/b/index.ts';
import * as candidateC from '../candidates/c/index.ts';
import type { Candidate, LabAudio, LabView } from './contracts.ts';
import { recordScenario, scenarios, type Recording } from './scenarios.ts';
import './style.css';

const root = document.querySelector<HTMLElement>('#lab')!;
root.innerHTML = `
<header><div><p class="eyebrow">JANGGI / DIRECTION LAB</p><h1>한 수의 감각</h1><p class="intro">같은 물리, 같은 샷으로 연출을 비교합니다.</p></div><a href="/">게임으로 돌아가기 ↗</a></header>
<div class="workspace"><section class="stage"><div class="stage-head"><span id="current">준비 중</span><span id="sound-state">무음</span></div><div id="canvas-wrap"><canvas id="table" width="${TABLE.width}" height="${TABLE.height}" aria-label="동일한 발사 기록을 재생하는 장기판" tabindex="0"></canvas></div><div class="transport"><button id="replay" class="primary">↻ 다시 발사 <kbd>R</kbd></button><button id="pause">일시정지 <kbd>Space</kbd></button><button id="mute">소리 켜기 <kbd>M</kbd></button></div><div class="progress"><div id="progress"></div></div><p id="status" role="status" aria-live="polite">물리 엔진을 준비하고 있습니다.</p></section>
<aside><section class="panel"><p class="eyebrow">01 / DIRECTION</p><h2>후보 선택</h2><div id="candidates" class="segmented"></div><button id="shuffle" class="quiet">익명 순서 다시 섞기</button><label class="check"><input id="details" type="checkbox"> 실제 방향 이름 보기</label><p id="direction-detail" class="note" hidden></p></section>
<section class="panel"><p class="eyebrow">02 / IDENTICAL SHOT</p><h2>공통 장면</h2><label class="field">장면<select id="scene">${scenarios.map(s => `<option value="${s.id}">${s.title}</option>`).join('')}</select></label><div class="segmented"><button id="normal">일반 <kbd>N</kbd></button><button id="power" aria-pressed="true">강타 <kbd>P</kbd></button></div><p id="scene-note" class="note"></p><label class="check"><input id="repeat" type="checkbox"> 자동 반복</label></section>
<section class="panel"><p class="eyebrow">03 / VIEWING CONDITIONS</p><h2>비교 조건</h2><label class="field">판 표시<select id="scale"><option value="desktop">데스크톱 · 최대 640px</option><option value="mobile">모바일 · 최대 390px</option></select></label><label class="check"><input id="motion" type="checkbox"> 동작 줄이기</label><label class="check"><input id="shake" type="checkbox" checked> 화면 흔들림</label><p class="note">준비 600ms → 실제 120Hz 기록 재생. 강타는 같은 명령에 규칙상의 1.25배만 적용합니다. 소리는 버튼을 눌러 활성화합니다.</p></section>
<section class="panel evidence"><h2>확인할 것</h2><p>먼저 중앙 일반/강타를 무음으로 반복하세요. 힘을 모으는 순간, 첫 접촉, 피격 방향이 읽히는지 확인합니다.</p><p>이 화면 자체는 청취·브라우저 조작·기기 성능 검증의 완료를 뜻하지 않습니다.</p><details><summary>키보드와 기록 정보</summary><p>1/2/3 후보 · 0 기준 · N 일반 · P 강타 · R 재발사 · Space 일시정지 · M 소리</p><pre id="record-info"></pre></details></section></aside></div>`;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('table');
const registry: Record<string, Candidate & { title: string }> = {
  a: { ...candidateA, title: '묵직한 실물 타격' }, b: { ...candidateB, title: '과감한 아케이드' }, c: { ...candidateC, title: '장기와 무협의 한 수' },
  baseline: { createView: canvas => new TableView(canvas), createAudio: () => new AudioPlayer(), title: 'v0.6 기준' },
};
let order = ['a', 'b', 'c'];
function shuffleOrder() { for (let i = order.length - 1; i > 0; i--) { const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); const j = bytes[0] % (i + 1); [order[i], order[j]] = [order[j], order[i]]; } }
shuffleOrder();
let key = order[0], powered = true, muted = true, paused = false, ready = false;
let view: LabView, audio: LabAudio, recording: Recording, cursor = -1, elapsed = 0, last = 0, playbackRevision = 0;
const motion = el<HTMLInputElement>('motion'), shake = el<HTMLInputElement>('shake');
const media = matchMedia('(prefers-reduced-motion: reduce)'); motion.checked = media.matches;
media.addEventListener('change', e => { motion.checked = e.matches; configureView(); });
function configureView() { if (view) { view.shaking = shake.checked && !motion.checked; view.effects = !motion.checked; } }
function buttons() {
  el('candidates').innerHTML = [...order.map((id, i) => `<button data-candidate="${id}" aria-pressed="${key === id}">${String.fromCharCode(65 + i)} <kbd>${i + 1}</kbd></button>`), `<button data-candidate="baseline" aria-pressed="${key === 'baseline'}">v0.6 <kbd>0</kbd></button>`].join('');
  const label = key === 'baseline' ? 'v0.6 기준' : `후보 ${String.fromCharCode(65 + order.indexOf(key))}`;
  el('current').textContent = `${label} · ${powered ? '강타' : '일반'}`;
  const detail = el('direction-detail'); detail.hidden = !el<HTMLInputElement>('details').checked;
  detail.textContent = `${label}: ${registry[key].title}`;
  el('normal').setAttribute('aria-pressed', String(!powered)); el('power').setAttribute('aria-pressed', String(powered));
}
function restart() {
  if (!ready) return;
  playbackRevision++;
  audio.reset(); view.clear(); configureView(); cursor = -1; elapsed = 0; paused = false;
  el('pause').innerHTML = '일시정지 <kbd>Space</kbd>';
  const scenario = scenarios.find(s => s.id === el<HTMLSelectElement>('scene').value)!;
  recording = recordScenario(scenario, powered);
  el('scene-note').textContent = scenario.note;
  el('record-info').textContent = JSON.stringify({ command: recording.command, frames: recording.frames.length, events: recording.frames.flatMap(f => f.events).map(e => e.kind), final: { tick: recording.frames.at(-1)!.state.tick, phase: recording.frames.at(-1)!.state.phase, winner: recording.frames.at(-1)!.state.winner } }, null, 2);
  buttons();
}
async function unlock() { const requested = audio; if (!muted) { try { await requested.unlock(); } catch { if (audio !== requested) return; muted = true; audio.enabled = false; updateSound(); el('status').textContent = '오디오를 시작하지 못했습니다. 소리 켜기를 다시 눌러 주세요.'; } } }
function selectCandidate(next: string) {
  if (!ready) return;
  audio?.suspend(); key = next; view?.clear(); view = registry[key].createView(canvas); audio = registry[key].createAudio(); audio.enabled = !muted;
  void unlock(); restart();
}
function updateSound() { el('mute').innerHTML = `${muted ? '소리 켜기' : '음소거'} <kbd>M</kbd>`; el('sound-state').textContent = muted ? '무음' : '유음'; }
function toggleSound() { muted = !muted; audio.enabled = !muted; updateSound(); if (!muted) { const requested = audio, revision = playbackRevision; void unlock().then(() => { if (audio === requested && !muted && revision === playbackRevision) restart(); }); } }
function togglePause() { paused = !paused; audio.reset(); el('pause').innerHTML = `${paused ? '계속 재생' : '일시정지'} <kbd>Space</kbd>`; }
el('candidates').addEventListener('click', e => { const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-candidate]'); if (button) selectCandidate(button.dataset.candidate!); });
el('shuffle').onclick = () => { shuffleOrder(); selectCandidate(order[0]); };
el('details').onchange = buttons;
el('normal').onclick = () => { powered = false; void unlock(); restart(); };
el('power').onclick = () => { powered = true; void unlock(); restart(); };
el('scene').onchange = () => { void unlock(); restart(); };
el('replay').onclick = () => { void unlock(); restart(); };
el('pause').onclick = () => { if (ready) togglePause(); };
el('mute').onclick = () => { if (ready) toggleSound(); };
motion.onchange = configureView; shake.onchange = configureView;
el('scale').onchange = () => { el('canvas-wrap').classList.toggle('mobile', el<HTMLSelectElement>('scale').value === 'mobile'); };
document.addEventListener('keydown', e => {
  if (!ready || e.repeat || (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName))) return;
  if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
  const k = e.key.toLowerCase();
  if (['1', '2', '3'].includes(k)) selectCandidate(order[Number(k) - 1]);
  else if (k === '0') selectCandidate('baseline');
  else if (k === 'n' || k === 'p') { powered = k === 'p'; void unlock(); restart(); }
  else if (k === 'r' || k === 'enter') { void unlock(); restart(); }
  else if (k === ' ') { e.preventDefault(); togglePause(); }
  else if (k === 'm') toggleSound();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && ready && !paused) togglePause(); });
function frame(now: number) {
  const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
  if (ready && recording) {
    const step = paused ? 0 : dt; elapsed += step;
    const playTime = Math.max(0, elapsed - .6), target = elapsed < .6 ? -1 : Math.min(recording.frames.length - 1, Math.floor(playTime * RULES.hz));
    while (cursor < target) { const previous = cursor < 0 ? recording.initial : recording.frames[cursor].state; const next = recording.frames[++cursor]; view.receive(next.events, previous); for (const event of next.events) audio.event(event, next.state); }
    const state = cursor < 0 ? recording.initial : recording.frames[cursor].state;
    const old = cursor <= 0 ? recording.initial : recording.frames[cursor - 1].state;
    const preparing = elapsed < .6;
    view.setPreparation?.(preparing ? 0 : null, preparing ? Math.min(1, elapsed / .6) * scenarios.find(s => s.id === el<HTMLSelectElement>('scene').value)!.force : 0, powered);
    const stone = recording.initial.stones[0], scenario = scenarios.find(s => s.id === el<HTMLSelectElement>('scene').value)!;
    const aim = preparing ? { stoneId: 0, x: stone.x - scenario.direction[0] * 1.5 * Math.min(1, elapsed / .6), y: stone.y - scenario.direction[1] * 1.5 * Math.min(1, elapsed / .6) } : null;
    view.render(state, step, preparing ? 0 : null, aim, old, preparing || cursor === recording.frames.length - 1 ? 1 : playTime * RULES.hz % 1);
    const duration = .6 + (recording.frames.length - 1) / RULES.hz + 1;
    el('progress').style.width = `${Math.min(100, elapsed / duration * 100)}%`;
    el('status').textContent = `${paused ? '일시정지 · ' : ''}${preparing ? '준비' : cursor === recording.frames.length - 1 ? '결과 여운' : '발사 기록 재생'} · ${(Math.min(elapsed, duration)).toFixed(2)}초 · ${state.tick} tick · ${recording.frames.slice(0, cursor + 1).reduce((n, f) => n + f.events.filter(e => e.kind === 'hit' || e.kind === 'hinge-hit').length, 0)}회 접촉`;
    if (!paused && elapsed > Math.max(3, duration) && el<HTMLInputElement>('repeat').checked) restart();
  }
  requestAnimationFrame(frame);
}
void initPhysics().then(() => { ready = true; selectCandidate(key); }).catch(error => { el('status').textContent = `시작 실패: ${String(error)}`; });
requestAnimationFrame(frame);
