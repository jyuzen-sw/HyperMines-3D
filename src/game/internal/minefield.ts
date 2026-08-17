import type { BoardDimensions } from '../constants';
import { assertCellId, boardCellCount, neighborIds } from '../coordinates';
import { hash32, mulberry32, normalizeSeed } from '../random';

export class Minefield3D {
  readonly seed: number;
  readonly dimensions: BoardDimensions;
  readonly mineCount: number;
  readonly safeFirstId: number;
  readonly #mines: Uint8Array;

  constructor(seed: number, dimensions: BoardDimensions, mineCount: number, safeFirstId: number) {
    const cellCount = boardCellCount(dimensions);
    assertCellId(safeFirstId, dimensions);
    if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount >= cellCount) {
      throw new RangeError(`Mine count out of range: ${mineCount}`);
    }

    this.seed = normalizeSeed(seed);
    this.dimensions = Object.freeze({ ...dimensions });
    this.mineCount = mineCount;
    this.safeFirstId = safeFirstId;
    this.#mines = new Uint8Array(cellCount);

    const protectedIds = new Set([safeFirstId, ...neighborIds(safeFirstId, dimensions)]);
    const candidates = Array.from({ length: cellCount }, (_, id) => id).filter(
      (id) => !protectedIds.has(id),
    );
    if (mineCount > candidates.length) {
      throw new RangeError(
        `Mine count ${mineCount} exceeds ${candidates.length} cells outside the safe opening`,
      );
    }
    const random = mulberry32(hash32(this.seed ^ 0x6d2b79f5, safeFirstId));
    for (let index = 0; index < mineCount; index += 1) {
      const swapIndex = index + Math.floor(random() * (candidates.length - index));
      const temporary = candidates[index]!;
      candidates[index] = candidates[swapIndex]!;
      candidates[swapIndex] = temporary;
      this.#mines[candidates[index]!] = 1;
    }
  }

  isMine(id: number): boolean {
    assertCellId(id, this.dimensions);
    return this.#mines[id] === 1;
  }

  clue(id: number): number {
    assertCellId(id, this.dimensions);
    let count = 0;
    for (const neighborId of neighborIds(id, this.dimensions)) {
      count += this.#mines[neighborId]!;
    }
    return count;
  }

  mineIdsForTesting(): readonly number[] {
    const ids: number[] = [];
    for (let id = 0; id < this.#mines.length; id += 1) {
      if (this.#mines[id] === 1) ids.push(id);
    }
    return Object.freeze(ids);
  }
}
