import { describe, expect, it } from 'vitest';

import {
  DIFFICULTIES,
  boardCellCount,
  coordinateToId,
  faceNeighborIds,
  hash32,
  idToCoordinate,
  isBoundaryCell,
  neighborIds,
} from '../../src/game';

const dimensions = { width: 5, height: 5, depth: 5 } as const;

describe('3次元座標', () => {
  it('全マスでIDとXYZ座標を一意に往復する', () => {
    expect(boardCellCount(dimensions)).toBe(125);
    for (let id = 0; id < boardCellCount(dimensions); id += 1) {
      expect(coordinateToId(idToCoordinate(id, dimensions), dimensions)).toBe(id);
    }
  });

  it('位置に応じて7・11・17・26個の近傍を返す', () => {
    const id = (x: number, y: number, z: number): number => coordinateToId({ x, y, z }, dimensions);
    expect(neighborIds(id(0, 0, 0), dimensions)).toHaveLength(7);
    expect(neighborIds(id(0, 0, 2), dimensions)).toHaveLength(11);
    expect(neighborIds(id(0, 2, 2), dimensions)).toHaveLength(17);
    expect(neighborIds(id(2, 2, 2), dimensions)).toHaveLength(26);
  });

  it('物理的な露出判定用の面近傍だけを区別する', () => {
    const corner = coordinateToId({ x: 0, y: 0, z: 0 }, dimensions);
    const center = coordinateToId({ x: 2, y: 2, z: 2 }, dimensions);
    expect(faceNeighborIds(corner, dimensions)).toHaveLength(3);
    expect(faceNeighborIds(center, dimensions)).toHaveLength(6);
    expect(isBoundaryCell(corner, dimensions)).toBe(true);
    expect(isBoundaryCell(center, dimensions)).toBe(false);
  });

  it('範囲外の座標とIDを拒否する', () => {
    expect(() => coordinateToId({ x: -1, y: 0, z: 0 }, dimensions)).toThrow(RangeError);
    expect(() => idToCoordinate(125, dimensions)).toThrow(RangeError);
  });
});

describe('盤面プリセットとseed', () => {
  it('選択された3段階の盤面サイズと地雷数を公開する', () => {
    expect(DIFFICULTIES.beginner).toMatchObject({ width: 5, height: 5, depth: 5, mineCount: 10 });
    expect(DIFFICULTIES.standard).toMatchObject({ width: 7, height: 7, depth: 7, mineCount: 40 });
    expect(DIFFICULTIES.expert).toMatchObject({ width: 9, height: 9, depth: 9, mineCount: 100 });
  });

  it('32bit値のハッシュを決定論的に生成する', () => {
    expect(hash32(42, 12345)).toBe(hash32(42, 12345));
    expect(hash32(42, 12345)).not.toBe(hash32(43, 12345));
  });
});
