import { describe, expect, it } from 'vitest';

import { decideAutoplay, type AutoDecision } from '../../src/autoplay';
import { Minesweeper3D, type DifficultyId, type GameAction } from '../../src/game';

function toGameAction(decision: Exclude<AutoDecision, { kind: 'stop' }>): GameAction {
  switch (decision.kind) {
    case 'reveal':
      return { type: 'reveal', cellId: decision.targetId };
    case 'flag':
      return { type: 'toggle-flag', cellId: decision.targetId };
    case 'chord':
      return { type: 'chord', cellId: decision.targetId };
  }
}

function simulate(seed: number, difficulty: DifficultyId): Extract<AutoDecision, { kind: 'stop' }> {
  const game = new Minesweeper3D(seed, difficulty);
  for (let step = 0; step < 2_000; step += 1) {
    const decision = decideAutoplay(game.observe());
    if (decision.kind === 'stop') return decision;
    const target = game.observe().cells[decision.targetId]!;
    if (decision.kind === 'reveal' || decision.kind === 'flag') {
      expect(target.isSurface).toBe(true);
    }
    const event = game.apply(toGameAction(decision));
    expect(event.changed).toBe(true);
  }
  throw new Error('AI did not stop within the step limit');
}

describe('固定盤面のAIアシスト', () => {
  it.each([
    ['beginner', 1],
    ['beginner', 20240807],
    ['standard', 73],
    ['expert', 991],
  ] as const)('%s / seed %d は終局または人間への引き渡しへ到達する', (difficulty, seed) => {
    const decision = simulate(seed, difficulty);
    expect(['won', 'lost', 'needs-human', 'contradiction']).toContain(decision.stopReason);
    expect(decision.stopReason).not.toBe('invalid-observation');
  });
});
