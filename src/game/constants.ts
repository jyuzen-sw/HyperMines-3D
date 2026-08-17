export const MAX_NEIGHBOR_COUNT = 26;

export type DifficultyId = 'beginner' | 'standard' | 'expert';

export interface BoardDimensions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface Difficulty extends BoardDimensions {
  readonly id: DifficultyId;
  readonly label: string;
  readonly description: string;
  readonly mineCount: number;
}

export const DIFFICULTIES: Readonly<Record<DifficultyId, Difficulty>> = Object.freeze({
  beginner: Object.freeze({
    id: 'beginner',
    label: '初級',
    description: '5 × 5 × 5 / 地雷 10',
    width: 5,
    height: 5,
    depth: 5,
    mineCount: 10,
  }),
  standard: Object.freeze({
    id: 'standard',
    label: '標準',
    description: '7 × 7 × 7 / 地雷 40',
    width: 7,
    height: 7,
    depth: 7,
    mineCount: 40,
  }),
  expert: Object.freeze({
    id: 'expert',
    label: '上級',
    description: '9 × 9 × 9 / 地雷 100',
    width: 9,
    height: 9,
    depth: 9,
    mineCount: 100,
  }),
});

export function isDifficultyId(value: unknown): value is DifficultyId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DIFFICULTIES, value);
}
