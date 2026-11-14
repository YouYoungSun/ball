/** Offline native-canvas render; this is not browser capture and contains no audio. */
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { initPhysics } from '../src/core/game.ts';
import { TABLE } from '../src/view/table.ts';
import { recordScenario, scenarios } from '../src/lab/scenarios.ts';
import type { Candidate } from '../src/lab/contracts.ts';
const require = createRequire(import.meta.url);
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc', 'Noto Serif KR');
(globalThis as any).document = { createElement: () => createCanvas(TABLE.width, TABLE.height) };
const candidates: Candidate[] = [];
for (const name of ['a', 'b', 'c']) {
  const mod = await import(`../src/candidates/${name}/index.ts`);
  candidates.push(mod.candidate ?? mod.default ?? mod);
}
await initPhysics();
const root = '../.tmp/lab-capture';
rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
mkdirSync('docs/experiment-media', { recursive: true });
const width = 390, height = Math.round(width * TABLE.height / TABLE.width / 2) * 2, fps = 30;
const encode = (prefix: string, dest: string, video = false) => {
  const args = video ? ['-framerate', '30', '-i', `${root}/${prefix}/%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', dest]
    : ['-framerate', '30', '-i', `${root}/${prefix}/%04d.png`, '-filter_complex', '[0:v]split[a][b];[a]palettegen=stats_mode=diff:max_colors=128[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', '-y', dest];
  const result = spawnSync('ffmpeg', ['-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${dest}`);
};
for (const power of [false, true]) {
  const label = power ? 'power' : 'normal';
  const recording = recordScenario(scenarios[0], power);
  const names = ['a', 'b', 'c'];
  const canvases = candidates.map(() => createCanvas(TABLE.width, TABLE.height));
  const views = candidates.map((c, i) => c.createView(canvases[i] as any));
  const scaled = candidates.map(() => createCanvas(width, height));
  const combinedWidth = 300, combinedHeight = Math.round(combinedWidth * TABLE.height / TABLE.width / 2) * 2;
  const combined = createCanvas(combinedWidth * 3, combinedHeight);
  for (const n of [...names, 'all-3']) mkdirSync(`${root}/${label}-${n}`, { recursive: true });
  const prep = 18, tail = 30;
  const duration = Math.max(90, Math.ceil((recording.frames.length - 1) / 4) + prep + tail);
  for (let frame = 0; frame < duration; frame++) {
    const starting = frame === prep;
    let state = recording.initial;
    if (frame >= prep) {
      const first = starting ? 0 : 1 + (frame - prep - 1) * 4;
      const last = starting ? 0 : Math.min(recording.frames.length - 1, first + 3);
      for (let t = first; t <= last; t++) {
        const item = recording.frames[t];
        const previous = t === 0 ? recording.initial : recording.frames[t - 1].state;
        for (const view of views) view.receive(item.events, previous);
      }
      state = recording.frames[Math.min(recording.frames.length - 1, starting ? 0 : 4 + (frame - prep - 1) * 4)].state;
    }
    for (let i = 0; i < views.length; i++) {
      const preparing = frame < prep;
      views[i].setPreparation?.(preparing ? 0 : null, preparing ? scenarios[0].force * (frame + 1) / prep : 0, preparing && power);
      views[i].render(state, 1 / fps, preparing ? 0 : null, preparing ? {stoneId: 0, x: 4.5, y: 8.0} : null);
      const ctx = scaled[i].getContext('2d'); ctx.drawImage(canvases[i], 0, 0, width, height);
      combined.getContext('2d').drawImage(scaled[i], i * combinedWidth, 0, combinedWidth, combinedHeight);
      writeFileSync(`${root}/${label}-${names[i]}/${String(frame).padStart(4, '0')}.png`, scaled[i].toBuffer('image/png'));
    }
    writeFileSync(`${root}/${label}-all-3/${String(frame).padStart(4, '0')}.png`, combined.toBuffer('image/png'));
    (globalThis as any).gc?.();
  }
  for (const n of [...names, 'all-3']) {
    const dest = `docs/experiment-media/${n}-${label}`;
    if (n === 'all-3') encode(`${label}-${n}`, `${dest}.gif`);
    encode(`${label}-${n}`, `${dest}.mp4`, true);
  }
  console.log(`${label}: ${duration} frames; ${recording.frames.length} physics ticks`);
}
