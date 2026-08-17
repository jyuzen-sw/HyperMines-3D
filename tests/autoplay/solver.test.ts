import { describe, expect, it } from 'vitest';

import { analyzeObservation, decideAutoplay, type PublicObservation } from '../../src/autoplay';
import { Minesweeper3D, coordinateToId } from '../../src/game';

type PublicCell = PublicObservation['cells'][number];

function observation(options: {
  readonly width?: number;
  readonly height?: number;
  readonly depth?: number;
  readonly mineCount: number;
  readonly cells: Readonly<Record<number, Partial<PublicCell>>>;
}): PublicObservation {
  const dimensions = {
    width: options.width ?? 4,
    height: options.height ?? 4,
    depth: options.depth ?? 4,
  };
  const count = dimensions.width * dimensions.height * dimensions.depth;
  const cells = Array.from({ length: count }, (_, id): PublicCell => {
    const layerSize = dimensions.width * dimensions.height;
    const z = Math.floor(id / layerSize);
    const remainder = id - z * layerSize;
    const y = Math.floor(remainder / dimensions.width);
    const x = remainder - y * dimensions.width;
    return {
      id,
      coordinate: { x, y, z },
      state: 'covered',
      clue: null,
      isSurface:
        x === 0 ||
        y === 0 ||
        z === 0 ||
        x === dimensions.width - 1 ||
        y === dimensions.height - 1 ||
        z === dimensions.depth - 1,
      ...options.cells[id],
    };
  });
  const flagCount = cells.filter((cell) => cell.state === 'flagged').length;
  return {
    revision: 1,
    status: 'playing',
    dimensions,
    mineCount: options.mineCount,
    remainingMines: options.mineCount - flagCount,
    flagCount,
    cells,
  };
}

describe('3D観測制約の推論', () => {
  it('0の手掛かりから26近傍をすべて安全と確定する', () => {
    const center = 1 + 4 * (1 + 4 * 1);
    const current = observation({
      mineCount: 1,
      cells: { [center]: { state: 'revealed', clue: 0, isSurface: false } },
    });
    const analysis = analyzeObservation(current);
    expect(analysis.contradiction).toBeNull();
    expect(analysis.safe.size).toBeGreaterThanOrEqual(27);
  });

  it('手掛かりと未確定数が一致すると全近傍を地雷と確定する', () => {
    const center = 1 + 4 * (1 + 4 * 1);
    const current = observation({
      mineCount: 26,
      cells: { [center]: { state: 'revealed', clue: 26, isSurface: false } },
    });
    const analysis = analyzeObservation(current);
    expect(analysis.contradiction).toBeNull();
    expect(analysis.mines).toHaveLength(26);
  });

  it('盤面全体の残り地雷数だけで全マスが地雷と確定しても矛盾しない', () => {
    const current = observation({
      width: 2,
      height: 2,
      depth: 2,
      mineCount: 8,
      cells: {},
    });
    const analysis = analyzeObservation(current);
    expect(analysis.contradiction).toBeNull();
    expect(analysis.mines.size).toBe(8);
  });

  it('複数解がある制約を確定扱いせず人間へ引き渡す', () => {
    const corner = 0;
    const current = observation({
      mineCount: 10,
      cells: { [corner]: { state: 'revealed', clue: 1, isSurface: false } },
    });
    const analysis = analyzeObservation(current);
    expect(analysis.contradiction).toBeNull();
    expect([...analysis.safe].filter((id) => current.cells[id]!.state === 'covered')).toEqual([]);
    expect([...analysis.mines].filter((id) => current.cells[id]!.state === 'covered')).toEqual([]);
    expect(decideAutoplay(current)).toMatchObject({
      kind: 'stop',
      stopReason: 'needs-human',
    });
  });

  it('矛盾した旗を検出して操作を止める', () => {
    const current = observation({
      mineCount: 2,
      cells: {
        0: { state: 'revealed', clue: 0, isSurface: false },
        1: { state: 'flagged', isSurface: true },
      },
    });
    expect(decideAutoplay(current)).toMatchObject({
      kind: 'stop',
      stopReason: 'contradiction',
    });
  });
});

describe('AIアシストの判断', () => {
  it('未開始盤面では最初の一手と周囲が安全な手前中央のマスを開く', () => {
    const game = new Minesweeper3D(1, 'beginner');
    const decision = decideAutoplay(game.observe());
    expect(decision).toMatchObject({ kind: 'reveal' });
    if (decision.kind !== 'reveal') throw new Error('Expected reveal');
    expect(game.observe().cells[decision.targetId]!.coordinate).toEqual({ x: 2, y: 2, z: 4 });
  });

  it('確定した地雷でも外側から操作可能になるまでは旗を置かない', () => {
    const center = coordinateToId({ x: 1, y: 1, z: 1 }, { width: 4, height: 4, depth: 4 });
    const current = observation({
      mineCount: 26,
      cells: { [center]: { state: 'revealed', clue: 26, isSurface: false } },
    });
    const decision = decideAutoplay(current);
    if (decision.kind === 'flag') {
      expect(current.cells[decision.targetId]!.isSurface).toBe(true);
    } else {
      expect(decision).toMatchObject({ kind: 'stop', stopReason: 'needs-human' });
    }
  });
});
