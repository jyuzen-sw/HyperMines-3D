import type { BoardDimensions } from './constants';

export interface CellCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function boardCellCount(dimensions: BoardDimensions): number {
  assertDimensions(dimensions);
  return dimensions.width * dimensions.height * dimensions.depth;
}

export function coordinateToId(coordinate: CellCoordinate, dimensions: BoardDimensions): number {
  assertCoordinate(coordinate, dimensions);
  return coordinate.x + dimensions.width * (coordinate.y + dimensions.height * coordinate.z);
}

export function idToCoordinate(id: number, dimensions: BoardDimensions): CellCoordinate {
  assertCellId(id, dimensions);
  const layerSize = dimensions.width * dimensions.height;
  const z = Math.floor(id / layerSize);
  const remainder = id - z * layerSize;
  const y = Math.floor(remainder / dimensions.width);
  const x = remainder - y * dimensions.width;
  return Object.freeze({ x, y, z });
}

export function neighborIds(id: number, dimensions: BoardDimensions): readonly number[] {
  const origin = idToCoordinate(id, dimensions);
  const neighbors: number[] = [];
  for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        if (xOffset === 0 && yOffset === 0 && zOffset === 0) continue;
        const coordinate = {
          x: origin.x + xOffset,
          y: origin.y + yOffset,
          z: origin.z + zOffset,
        };
        if (isCoordinateInside(coordinate, dimensions)) {
          neighbors.push(coordinateToId(coordinate, dimensions));
        }
      }
    }
  }
  return Object.freeze(neighbors);
}

export function faceNeighborIds(id: number, dimensions: BoardDimensions): readonly number[] {
  const origin = idToCoordinate(id, dimensions);
  const offsets: readonly CellCoordinate[] = [
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 0, z: 1 },
  ];
  return Object.freeze(
    offsets.flatMap((offset) => {
      const coordinate = {
        x: origin.x + offset.x,
        y: origin.y + offset.y,
        z: origin.z + offset.z,
      };
      return isCoordinateInside(coordinate, dimensions)
        ? [coordinateToId(coordinate, dimensions)]
        : [];
    }),
  );
}

export function isBoundaryCell(id: number, dimensions: BoardDimensions): boolean {
  const { x, y, z } = idToCoordinate(id, dimensions);
  return (
    x === 0 ||
    y === 0 ||
    z === 0 ||
    x === dimensions.width - 1 ||
    y === dimensions.height - 1 ||
    z === dimensions.depth - 1
  );
}

export function formatCoordinate(coordinate: CellCoordinate): string {
  return `X${coordinate.x + 1} · Y${coordinate.y + 1} · Z${coordinate.z + 1}`;
}

export function isCoordinateInside(
  coordinate: CellCoordinate,
  dimensions: BoardDimensions,
): boolean {
  return (
    Number.isInteger(coordinate.x) &&
    Number.isInteger(coordinate.y) &&
    Number.isInteger(coordinate.z) &&
    coordinate.x >= 0 &&
    coordinate.x < dimensions.width &&
    coordinate.y >= 0 &&
    coordinate.y < dimensions.height &&
    coordinate.z >= 0 &&
    coordinate.z < dimensions.depth
  );
}

export function assertCellId(id: number, dimensions: BoardDimensions): void {
  const count = boardCellCount(dimensions);
  if (!Number.isInteger(id) || id < 0 || id >= count) {
    throw new RangeError(`Cell id out of range: ${id}`);
  }
}

export function assertDimensions(dimensions: BoardDimensions): void {
  const values = [
    ['width', dimensions.width],
    ['height', dimensions.height],
    ['depth', dimensions.depth],
  ] as const;
  for (const [name, value] of values) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`Board ${name} must be a positive integer: ${value}`);
    }
  }
}

function assertCoordinate(coordinate: CellCoordinate, dimensions: BoardDimensions): void {
  if (!isCoordinateInside(coordinate, dimensions)) {
    throw new RangeError(
      `Coordinate out of range: (${coordinate.x}, ${coordinate.y}, ${coordinate.z})`,
    );
  }
}
