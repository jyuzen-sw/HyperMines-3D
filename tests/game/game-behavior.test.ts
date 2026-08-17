import { describe, expect, it } from 'vitest';

import { DIFFICULTIES, Minesweeper3D, coordinateToId, neighborIds } from '../../src/game';
import { Minefield3D } from '../../src/game/internal/testing';

const beginner = DIFFICULTIES.beginner;
const cornerId = coordinateToId({ x: 0, y: 0, z: 0 }, beginner);

function fieldFor(game: Minesweeper3D, firstId: number): Minefield3D {
  return new Minefield3D(game.seed, beginner, beginner.mineCount, firstId);
}

function findChordScenario(): {
  readonly seed: number;
  readonly clueId: number;
  readonly mineNeighbors: readonly number[];
  readonly safeNeighbors: readonly number[];
  readonly flaggableSafeNeighbors: readonly number[];
} {
  for (let seed = 1; seed < 10_000; seed += 1) {
    const game = new Minesweeper3D(seed, 'beginner');
    game.apply({ type: 'reveal', cellId: cornerId });
    const field = fieldFor(game, cornerId);
    const observation = game.observe();
    for (const clue of observation.cells) {
      if (clue.state !== 'revealed' || clue.clue === null || clue.clue === 0) continue;
      const neighbors = neighborIds(clue.id, beginner);
      const mineNeighbors = neighbors.filter((id) => field.isMine(id));
      const safeNeighbors = neighbors.filter(
        (id) => !field.isMine(id) && observation.cells[id]!.state === 'covered',
      );
      const flaggableSafeNeighbors = safeNeighbors.filter((id) => observation.cells[id]!.isSurface);
      if (
        mineNeighbors.length === clue.clue &&
        mineNeighbors.length <= flaggableSafeNeighbors.length &&
        safeNeighbors.length > 0 &&
        mineNeighbors.every((id) => observation.cells[id]!.isSurface)
      ) {
        return {
          seed,
          clueId: clue.id,
          mineNeighbors,
          safeNeighbors,
          flaggableSafeNeighbors,
        };
      }
    }
  }
  throw new Error('Chord scenario not found');
}

describe('外部から観測できるゲーム操作', () => {
  it('操作可能な地雷を開くと即敗北し、地雷配置を公開する', () => {
    let scenario: { game: Minesweeper3D; field: Minefield3D; mineId: number } | undefined;
    for (let seed = 1; seed < 500 && scenario === undefined; seed += 1) {
      const game = new Minesweeper3D(seed, 'beginner');
      const firstId = coordinateToId({ x: 2, y: 2, z: 4 }, game.dimensions);
      game.apply({ type: 'reveal', cellId: firstId });
      const field = fieldFor(game, firstId);
      const mine = game
        .observe()
        .cells.find((cell) => cell.state === 'covered' && cell.isSurface && field.isMine(cell.id));
      if (mine !== undefined) scenario = { game, field, mineId: mine.id };
    }
    expect(scenario).toBeDefined();
    expect(scenario!.game.observe().cells.some((cell) => cell.state === 'mine')).toBe(false);
    expect(scenario!.game.apply({ type: 'reveal', cellId: scenario!.mineId })).toMatchObject({
      type: 'detonated',
      status: 'lost',
    });
    expect(scenario!.game.observe().cells.filter((cell) => cell.state === 'mine')).toHaveLength(
      beginner.mineCount - 1,
    );
  });

  it('正しい旗数で数字の周囲をまとめて開く', () => {
    const scenario = findChordScenario();
    const game = new Minesweeper3D(scenario.seed, 'beginner');
    game.apply({ type: 'reveal', cellId: cornerId });
    for (const mineId of scenario.mineNeighbors) {
      expect(game.apply({ type: 'toggle-flag', cellId: mineId }).type).toBe('flagged');
    }
    const event = game.apply({ type: 'chord', cellId: scenario.clueId });
    expect(event).toMatchObject({ type: 'chorded', changed: true });
    expect(game.status).not.toBe('lost');
    expect(
      scenario.safeNeighbors.some((id) => game.observe().cells[id]!.state === 'revealed'),
    ).toBe(true);
  });

  it('誤った旗で周囲をまとめて開くと未指定の地雷が爆発する', () => {
    const scenario = findChordScenario();
    const game = new Minesweeper3D(scenario.seed, 'beginner');
    game.apply({ type: 'reveal', cellId: cornerId });
    for (const safeId of scenario.flaggableSafeNeighbors.slice(0, scenario.mineNeighbors.length)) {
      game.apply({ type: 'toggle-flag', cellId: safeId });
    }
    expect(game.apply({ type: 'chord', cellId: scenario.clueId })).toMatchObject({
      type: 'detonated',
      status: 'lost',
    });
  });

  it('地雷に旗を置きながら安全なマスを全て開くと勝利する', () => {
    const game = new Minesweeper3D(20240807, 'beginner');
    const firstId = coordinateToId({ x: 2, y: 2, z: 4 }, game.dimensions);
    const field = fieldFor(game, firstId);
    game.apply({ type: 'reveal', cellId: firstId });

    let operations = 0;
    while (game.status === 'playing' && operations < 2_000) {
      const target = game
        .observe()
        .cells.find((cell) => cell.state === 'covered' && cell.isSurface);
      if (target === undefined) break;
      game.apply({
        type: field.isMine(target.id) ? 'toggle-flag' : 'reveal',
        cellId: target.id,
      });
      operations += 1;
    }

    expect(game.status).toBe('won');
    expect(game.revealedCount).toBe(game.safeCellCount);
    expect(game.flagCount).toBe(beginner.mineCount);
  });

  it('状態が変わる操作だけrevisionを進める', () => {
    const game = new Minesweeper3D(1, 'beginner');
    const center = coordinateToId({ x: 2, y: 2, z: 2 }, game.dimensions);
    expect(game.apply({ type: 'reveal', cellId: center }).changed).toBe(false);
    expect(game.revision).toBe(0);
    expect(game.apply({ type: 'toggle-flag', cellId: cornerId }).revision).toBe(1);
    expect(game.apply({ type: 'toggle-flag', cellId: cornerId }).revision).toBe(2);
  });
});

describe('PublicObservation', () => {
  it('終局前はseedと地雷配置を漏らさない', () => {
    const game = new Minesweeper3D(0x12345678, 'beginner');
    game.apply({ type: 'reveal', cellId: cornerId });
    const observation = game.observe();
    expect(observation).not.toHaveProperty('seed');
    expect(observation).not.toHaveProperty('minefield');
    expect(observation.cells.some((cell) => cell.state === 'mine')).toBe(false);
    expect(Object.keys(game)).toEqual([]);
  });

  it('スナップショットとマスを外部から変更できない', () => {
    const observation = new Minesweeper3D(1, 'beginner').observe();
    expect(Object.isFrozen(observation)).toBe(true);
    expect(Object.isFrozen(observation.cells)).toBe(true);
    expect(Object.isFrozen(observation.cells[0])).toBe(true);
    expect(Object.isFrozen(observation.cells[0]!.coordinate)).toBe(true);
  });
});
