import { describe, expect, it } from 'vitest';

import {
  DIFFICULTIES,
  Minesweeper3D,
  coordinateToId,
  neighborIds,
  type DifficultyId,
} from '../../src/game';
import { Minefield3D } from '../../src/game/internal/testing';

function frontCenter(game: Minesweeper3D): number {
  const { width, height, depth } = game.dimensions;
  return coordinateToId(
    { x: Math.floor(width / 2), y: Math.floor(height / 2), z: depth - 1 },
    game.dimensions,
  );
}

describe('地雷配置', () => {
  it.each(Object.keys(DIFFICULTIES) as DifficultyId[])(
    '%sは指定数の地雷を置き、最初のマスと全近傍を安全にする',
    (difficultyId) => {
      const difficulty = DIFFICULTIES[difficultyId];
      const firstId = coordinateToId(
        {
          x: Math.floor(difficulty.width / 2),
          y: Math.floor(difficulty.height / 2),
          z: difficulty.depth - 1,
        },
        difficulty,
      );
      const field = new Minefield3D(12345, difficulty, difficulty.mineCount, firstId);
      expect(field.mineIdsForTesting()).toHaveLength(difficulty.mineCount);
      expect(field.isMine(firstId)).toBe(false);
      expect(neighborIds(firstId, difficulty).every((id) => !field.isMine(id))).toBe(true);
      expect(field.clue(firstId)).toBe(0);
      expect(
        new Minefield3D(12345, difficulty, difficulty.mineCount, firstId).mineIdsForTesting(),
      ).toEqual(field.mineIdsForTesting());
    },
  );

  it.each([
    ['面', { x: 2, y: 2, z: 4 }, 17],
    ['辺', { x: 0, y: 2, z: 4 }, 11],
    ['角', { x: 0, y: 0, z: 4 }, 7],
  ] as const)('%sから始めても盤内に存在する近傍をすべて保護する', (_, coordinate, count) => {
    const difficulty = DIFFICULTIES.beginner;
    const firstId = coordinateToId(coordinate, difficulty);
    const neighbors = neighborIds(firstId, difficulty);
    const field = new Minefield3D(12345, difficulty, difficulty.mineCount, firstId);
    expect(neighbors).toHaveLength(count);
    expect(neighbors.every((id) => !field.isMine(id))).toBe(true);
  });

  it('安全領域の外へ指定数の地雷を配置できない盤面を拒否する', () => {
    expect(() => new Minefield3D(1, { width: 2, height: 2, depth: 2 }, 1, 0)).toThrow(
      /outside the safe opening/,
    );
  });

  it('手掛かりが26近傍にある地雷数と一致する', () => {
    const difficulty = DIFFICULTIES.beginner;
    const firstId = coordinateToId({ x: 2, y: 2, z: 4 }, difficulty);
    const field = new Minefield3D(9876, difficulty, difficulty.mineCount, firstId);
    const targetId = coordinateToId({ x: 2, y: 2, z: 2 }, difficulty);
    const expected = neighborIds(targetId, difficulty).filter((id) => field.isMine(id)).length;
    expect(field.clue(targetId)).toBe(expected);
  });
});

describe('Minesweeper3Dの外側から開くルール', () => {
  it('開始前は外周だけを操作可能にする', () => {
    const game = new Minesweeper3D(1, 'beginner');
    const observation = game.observe();
    expect(observation.status).toBe('ready');
    expect(observation.cells.filter((cell) => cell.isSurface)).toHaveLength(98);
    expect(observation.cells.filter((cell) => !cell.isSurface)).toHaveLength(27);
  });

  it('最初の一手で数字0の安全領域をすべて開く', () => {
    const game = new Minesweeper3D(1, 'beginner');
    const firstId = frontCenter(game);
    const event = game.apply({ type: 'reveal', cellId: firstId });
    expect(event).toMatchObject({ type: 'revealed', started: true, changed: true });
    expect(game.status).not.toBe('ready');
    expect(game.status).not.toBe('lost');
    expect(game.firstRevealId).toBe(firstId);
    const observation = game.observe();
    expect(observation.cells[firstId]).toMatchObject({ state: 'revealed', clue: 0 });
    expect(
      [firstId, ...neighborIds(firstId, game.dimensions)].every(
        (id) => observation.cells[id]!.state === 'revealed',
      ),
    ).toBe(true);
    if (event.type !== 'revealed') throw new Error('Expected the first cell to be revealed');
    expect(event.revealed).toBeGreaterThanOrEqual(18);
  });

  it('外側から操作可能になっていない内部のマスは直接操作できない', () => {
    const game = new Minesweeper3D(1, 'beginner');
    const center = coordinateToId({ x: 2, y: 2, z: 2 }, game.dimensions);
    expect(game.apply({ type: 'reveal', cellId: center })).toMatchObject({
      type: 'rejected',
      reason: 'not-surface',
    });
    expect(game.apply({ type: 'toggle-flag', cellId: center })).toMatchObject({
      type: 'rejected',
      reason: 'not-surface',
    });
    expect(game.revision).toBe(0);
  });

  it('旗ONで奥の面を露出し、旗OFFで元へ戻す', () => {
    const game = new Minesweeper3D(1, 'beginner');
    const outer = coordinateToId({ x: 2, y: 2, z: 4 }, game.dimensions);
    const inner = coordinateToId({ x: 2, y: 2, z: 3 }, game.dimensions);
    expect(game.isSurfaceCell(inner)).toBe(false);
    expect(game.apply({ type: 'toggle-flag', cellId: outer }).type).toBe('flagged');
    expect(game.isSurfaceCell(inner)).toBe(true);
    expect(game.apply({ type: 'toggle-flag', cellId: outer }).type).toBe('unflagged');
    expect(game.isSurfaceCell(inner)).toBe(false);
  });

  it('地雷数を超える旗を拒否する', () => {
    const game = new Minesweeper3D(1, 'beginner');
    const surface = game.observe().cells.filter((cell) => cell.isSurface);
    for (const cell of surface.slice(0, 10)) {
      expect(game.apply({ type: 'toggle-flag', cellId: cell.id }).changed).toBe(true);
    }
    expect(game.apply({ type: 'toggle-flag', cellId: surface[10]!.id })).toMatchObject({
      type: 'rejected',
      reason: 'flag-limit',
    });
  });
});
