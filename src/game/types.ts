import type { BoardDimensions, DifficultyId } from './constants';
import type { CellCoordinate } from './coordinates';

export type GameStatus = 'ready' | 'playing' | 'won' | 'lost';
export type ActionMode = 'open' | 'flag';

export type GameAction =
  | Readonly<{ type: 'reveal'; cellId: number }>
  | Readonly<{ type: 'toggle-flag'; cellId: number }>
  | Readonly<{ type: 'chord'; cellId: number }>;

export type PublicCellState =
  'covered' | 'revealed' | 'flagged' | 'mine' | 'detonated' | 'wrong-flag';

export interface CellObservation {
  readonly id: number;
  readonly coordinate: CellCoordinate;
  readonly state: PublicCellState;
  readonly clue: number | null;
  readonly isSurface: boolean;
}

export interface PublicObservation {
  readonly revision: number;
  readonly difficultyId: DifficultyId;
  readonly status: GameStatus;
  readonly dimensions: BoardDimensions;
  readonly mineCount: number;
  readonly remainingMines: number;
  readonly flagCount: number;
  readonly revealedCount: number;
  readonly safeCellCount: number;
  readonly progress: number;
  readonly firstRevealId: number | null;
  readonly cells: readonly CellObservation[];
}

export type GameRejectionReason =
  | 'game-over'
  | 'cell-revealed'
  | 'cell-flagged'
  | 'not-surface'
  | 'flag-limit'
  | 'chord-needs-clue'
  | 'chord-count-mismatch'
  | 'chord-no-targets';

interface GameEventBase<TAction extends GameAction = GameAction> {
  readonly action: TAction;
  readonly revision: number;
  readonly status: GameStatus;
  readonly changed: boolean;
}

export interface RejectedGameEvent extends GameEventBase {
  readonly type: 'rejected';
  readonly changed: false;
  readonly reason: GameRejectionReason;
  readonly expected?: number;
  readonly actual?: number;
}

export interface RevealedGameEvent extends GameEventBase<Extract<GameAction, { type: 'reveal' }>> {
  readonly type: 'revealed';
  readonly changed: true;
  readonly targetId: number;
  readonly revealed: number;
  readonly started: boolean;
}

export interface FlagGameEvent extends GameEventBase<Extract<GameAction, { type: 'toggle-flag' }>> {
  readonly type: 'flagged' | 'unflagged';
  readonly changed: true;
  readonly targetId: number;
}

export interface ChordGameEvent extends GameEventBase<Extract<GameAction, { type: 'chord' }>> {
  readonly type: 'chorded';
  readonly changed: true;
  readonly targetId: number;
  readonly revealed: number;
}

export interface DetonatedGameEvent extends GameEventBase {
  readonly type: 'detonated';
  readonly changed: true;
  readonly targetId: number;
  readonly revealed: number;
}

export type GameEvent =
  RejectedGameEvent | RevealedGameEvent | FlagGameEvent | ChordGameEvent | DetonatedGameEvent;
