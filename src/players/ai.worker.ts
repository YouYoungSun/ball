import { initPhysics } from '../core/game.ts';
import { chooseShot } from './ai.ts';
import type { Difficulty } from './ai.ts';
import type { MatchSnapshot } from '../core/types.ts';
self.onmessage = async (e: MessageEvent<{ snapshot: MatchSnapshot; difficulty: Difficulty; requestId: number }>) => {
  const { snapshot, difficulty, requestId } = e.data;
  try { await initPhysics(); self.postMessage({ requestId, command: chooseShot(snapshot, difficulty) }); }
  catch (error) { self.postMessage({ requestId, error: String(error) }); }
};
