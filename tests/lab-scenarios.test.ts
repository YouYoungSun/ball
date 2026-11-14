import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Game, initPhysics } from '../src/core/game.ts';
import { RULES } from '../src/core/rules.ts';
import { recordScenario, scenarios } from '../src/lab/scenarios.ts';

before(async () => { await initPhysics(); });

for (const scenario of scenarios) for (const powered of [false, true]) {
  test(`lab ${scenario.id}/${powered ? 'power' : 'normal'} records the unchanged core tick by tick`, () => {
    const original = structuredClone(scenario);
    const recording = recordScenario(scenario, powered);
    const core = new Game(recording.initial.matchId, scenario.seeds);
    try {
      assert.deepEqual(core.state(), recording.initial);
      assert.ok(core.shoot(recording.command).accepted);
      for (let index = 0; index < recording.frames.length; index++) {
        if (index) core.stepFixed();
        assert.deepEqual(core.state(), recording.frames[index].state);
        assert.deepEqual(core.drainEvents(), recording.frames[index].events);
      }
      assert.equal(core.isMoving, false, 'recording contains the full settled result');
      assert.ok(recording.frames.length <= RULES.maxShotTicks + 2);
      assert.equal(recording.frames[0].events[0].kind, 'shot');
      assert.equal(recording.frames[0].state.skillUsed[0], powered);
      assert.deepEqual(scenario, original, 'recording must not edit scenario seeds');
      assert.equal(recording.signature, recordScenario(scenario, powered).signature, 'repeat is deterministic');
    } finally { core.free(); }
  });
}

test('central comparison contains real first contact for both shots', () => {
  for (const power of [false, true]) {
    const recording = recordScenario(scenarios[0], power);
    assert.ok(recording.frames.some(frame => frame.events.some(event => event.kind === 'hit')));
  }
});

test('hinge comparison records metal contact before its wooden collision', () => {
  const scenario = scenarios.find(scenario => scenario.id === 'hinge')!;
  for (const power of [false, true]) {
    const events = recordScenario(scenario, power).frames.flatMap(frame => frame.events);
    const metal = events.find(event => event.kind === 'hinge-hit');
    const wood = events.find(event => event.kind === 'hit');
    assert.ok(metal && wood);
    assert.ok(metal.tick < wood.tick);
  }
});

test('mass comparisons preserve the announced shooter and target kinds', () => {
  for (const [id, shooter, target] of [['heavy', 'chariot', 'soldier'], ['light', 'soldier', 'chariot']]) {
    const scenario = scenarios.find(scenario => scenario.id === id)!;
    for (const power of [false, true]) {
      const recording = recordScenario(scenario, power);
      assert.equal(recording.initial.stones[0].kind, shooter);
      assert.equal(recording.initial.stones[1].kind, target);
      assert.ok(recording.frames.some(frame => frame.events.some(event => event.kind === 'hit' && event.a === 0 && event.b === 1)));
    }
  }
});

test('edge comparison hits and removes the opposing last stone before declaring victory', () => {
  const scenario = scenarios.find(scenario => scenario.id === 'edge')!;
  for (const power of [false, true]) {
    const events = recordScenario(scenario, power).frames.flatMap(frame => frame.events);
    const hit = events.find(event => event.kind === 'hit');
    const fall = events.find(event => event.kind === 'removed' && event.stoneId === 1);
    const finish = events.find(event => event.kind === 'match-ended');
    assert.ok(hit && fall && finish);
    assert.ok(hit.tick < fall.tick && fall.tick < finish.tick);
    assert.equal(finish.winner, 0);
  }
});
