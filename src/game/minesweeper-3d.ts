import { DIFFICULTIES, type DifficultyId } from './constants';
import {
  assertCellId,
  boardCellCount,
  faceNeighborIds,
  idToCoordinate,
  isBoundaryCell,
  neighborIds,
} from './coordinates';
import { Minefield3D } from './internal/minefield';
import { randomSeed } from './random';
import type {
  CellObservation,
  ChordGameEvent,
  DetonatedGameEvent,
  FlagGameEvent,
  GameAction,
  GameEvent,
  GameRejectionReason,
  GameStatus,
  PublicCellState,
  PublicObservation,
  RejectedGameEvent,
  RevealedGameEvent,
} from './types';

const COVERED = 0;
const REVEALED = 1;
const FLAGGED = 2;
const DETONATED = 3;

export class Minesweeper3D {
  readonly #difficulty;
  readonly #states: Uint8Array;
  readonly #clues: Int8Array;
  readonly #seed: number;
  #minefield: Minefield3D | null = null;
  #status: GameStatus = 'ready';
  #revision = 0;
  #flagCount = 0;
  #revealedCount = 0;
  #firstRevealId: number | null = null;
  #observationCache: PublicObservation | undefined;

  constructor(seed = randomSeed(), difficultyId: DifficultyId = 'beginner') {
    const difficulty = DIFFICULTIES[difficultyId];
    if (difficulty === undefined) {
      throw new RangeError(`Unknown difficulty: ${difficultyId as string}`);
    }
    this.#difficulty = difficulty;
    this.#seed = seed >>> 0;
    this.#states = new Uint8Array(boardCellCount(difficulty));
    this.#clues = new Int8Array(this.#states.length);
    this.#clues.fill(-1);
  }

  get seed(): number {
    return this.#seed;
  }

  get difficultyId(): DifficultyId {
    return this.#difficulty.id;
  }

  get dimensions() {
    return Object.freeze({
      width: this.#difficulty.width,
      height: this.#difficulty.height,
      depth: this.#difficulty.depth,
    });
  }

  get status(): GameStatus {
    return this.#status;
  }

  get revision(): number {
    return this.#revision;
  }

  get firstRevealId(): number | null {
    return this.#firstRevealId;
  }

  get revealedCount(): number {
    return this.#revealedCount;
  }

  get flagCount(): number {
    return this.#flagCount;
  }

  get safeCellCount(): number {
    return this.#states.length - this.#difficulty.mineCount;
  }

  apply(action: GameAction): GameEvent {
    const snapshot = Object.freeze({ ...action }) as GameAction;
    const cellId = snapshot.cellId;
    assertCellId(cellId, this.#difficulty);
    if (this.#status === 'won' || this.#status === 'lost') {
      return this.#reject(snapshot, 'game-over');
    }

    switch (snapshot.type) {
      case 'reveal':
        return this.#reveal(snapshot);
      case 'toggle-flag':
        return this.#toggleFlag(snapshot);
      case 'chord':
        return this.#chord(snapshot);
    }
  }

  isSurfaceCell(id: number): boolean {
    assertCellId(id, this.#difficulty);
    const state = this.#states[id];
    if (state === FLAGGED) return true;
    if (state !== COVERED) return false;
    if (isBoundaryCell(id, this.#difficulty)) return true;
    return faceNeighborIds(id, this.#difficulty).some((neighborId) => {
      const neighborState = this.#states[neighborId];
      return neighborState === REVEALED || neighborState === FLAGGED;
    });
  }

  observe(): PublicObservation {
    if (this.#observationCache !== undefined) return this.#observationCache;

    const cells: CellObservation[] = [];
    for (let id = 0; id < this.#states.length; id += 1) {
      const state = this.#publicState(id);
      cells.push(
        Object.freeze({
          id,
          coordinate: idToCoordinate(id, this.#difficulty),
          state,
          clue: state === 'revealed' ? this.#clues[id]! : null,
          isSurface: this.isSurfaceCell(id),
        }),
      );
    }

    const observation: PublicObservation = Object.freeze({
      revision: this.#revision,
      difficultyId: this.#difficulty.id,
      status: this.#status,
      dimensions: this.dimensions,
      mineCount: this.#difficulty.mineCount,
      remainingMines: this.#difficulty.mineCount - this.#flagCount,
      flagCount: this.#flagCount,
      revealedCount: this.#revealedCount,
      safeCellCount: this.safeCellCount,
      progress: this.safeCellCount === 0 ? 1 : this.#revealedCount / this.safeCellCount,
      firstRevealId: this.#firstRevealId,
      cells: Object.freeze(cells),
    });
    this.#observationCache = observation;
    return observation;
  }

  #reveal(action: Extract<GameAction, { type: 'reveal' }>): GameEvent {
    const state = this.#states[action.cellId];
    if (state === FLAGGED) return this.#reject(action, 'cell-flagged');
    if (state === REVEALED) return this.#chord({ type: 'chord', cellId: action.cellId });
    if (!this.isSurfaceCell(action.cellId)) return this.#reject(action, 'not-surface');

    const started = this.#minefield === null;
    if (started) {
      this.#firstRevealId = action.cellId;
      this.#minefield = new Minefield3D(
        this.#seed,
        this.#difficulty,
        this.#difficulty.mineCount,
        action.cellId,
      );
      this.#status = 'playing';
    }

    if (this.#minefield!.isMine(action.cellId)) {
      return this.#detonate(action, action.cellId, 0);
    }
    const revealed = this.#revealSafeRegion(action.cellId);
    this.#checkWin();
    return this.#commit<RevealedGameEvent>({
      type: 'revealed',
      action,
      changed: true,
      targetId: action.cellId,
      revealed,
      started,
    });
  }

  #toggleFlag(action: Extract<GameAction, { type: 'toggle-flag' }>): GameEvent {
    const state = this.#states[action.cellId];
    if (state === REVEALED) return this.#reject(action, 'cell-revealed');
    if (state === FLAGGED) {
      this.#states[action.cellId] = COVERED;
      this.#flagCount -= 1;
      return this.#commit<FlagGameEvent>({
        type: 'unflagged',
        action,
        changed: true,
        targetId: action.cellId,
      });
    }
    if (!this.isSurfaceCell(action.cellId)) return this.#reject(action, 'not-surface');
    if (this.#flagCount >= this.#difficulty.mineCount) {
      return this.#reject(action, 'flag-limit');
    }
    this.#states[action.cellId] = FLAGGED;
    this.#flagCount += 1;
    return this.#commit<FlagGameEvent>({
      type: 'flagged',
      action,
      changed: true,
      targetId: action.cellId,
    });
  }

  #chord(action: Extract<GameAction, { type: 'chord' }>): GameEvent {
    if (this.#states[action.cellId] !== REVEALED || this.#minefield === null) {
      return this.#reject(action, 'chord-needs-clue');
    }
    const clue = this.#clues[action.cellId]!;
    const neighbors = neighborIds(action.cellId, this.#difficulty);
    const flags = neighbors.filter((id) => this.#states[id] === FLAGGED).length;
    if (flags !== clue) {
      return this.#reject(action, 'chord-count-mismatch', clue, flags);
    }
    const targets = neighbors.filter((id) => this.#states[id] === COVERED);
    if (targets.length === 0) return this.#reject(action, 'chord-no-targets');

    const mineId = targets.find((id) => this.#minefield!.isMine(id));
    if (mineId !== undefined) return this.#detonate(action, mineId, 0);

    let revealed = 0;
    for (const targetId of targets) {
      revealed += this.#revealSafeRegion(targetId);
    }
    this.#checkWin();
    return this.#commit<ChordGameEvent>({
      type: 'chorded',
      action,
      changed: true,
      targetId: action.cellId,
      revealed,
    });
  }

  #revealSafeRegion(startId: number): number {
    const queue = [startId];
    const queued = new Set<number>(queue);
    let revealed = 0;
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (this.#states[id] !== COVERED || this.#minefield!.isMine(id)) continue;
      const clue = this.#minefield!.clue(id);
      this.#states[id] = REVEALED;
      this.#clues[id] = clue;
      this.#revealedCount += 1;
      revealed += 1;
      if (clue !== 0) continue;
      for (const neighborId of neighborIds(id, this.#difficulty)) {
        if (this.#states[neighborId] === COVERED && !queued.has(neighborId)) {
          queued.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
    return revealed;
  }

  #detonate(action: GameAction, targetId: number, revealed: number): DetonatedGameEvent {
    this.#states[targetId] = DETONATED;
    this.#status = 'lost';
    return this.#commit<DetonatedGameEvent>({
      type: 'detonated',
      action,
      changed: true,
      targetId,
      revealed,
    });
  }

  #checkWin(): void {
    if (this.#revealedCount !== this.safeCellCount || this.#minefield === null) return;
    this.#status = 'won';
    for (let id = 0; id < this.#states.length; id += 1) {
      if (this.#minefield.isMine(id) && this.#states[id] !== FLAGGED) {
        this.#states[id] = FLAGGED;
        this.#flagCount += 1;
      }
    }
  }

  #publicState(id: number): PublicCellState {
    const state = this.#states[id];
    if (state === REVEALED) return 'revealed';
    if (state === DETONATED) return 'detonated';
    if (state === FLAGGED) {
      if (this.#status === 'lost' && !this.#minefield!.isMine(id)) return 'wrong-flag';
      return 'flagged';
    }
    if (this.#status === 'lost' && this.#minefield!.isMine(id)) return 'mine';
    return 'covered';
  }

  #reject(
    action: GameAction,
    reason: GameRejectionReason,
    expected?: number,
    actual?: number,
  ): RejectedGameEvent {
    return Object.freeze({
      type: 'rejected',
      action,
      revision: this.#revision,
      status: this.#status,
      changed: false,
      reason,
      ...(expected === undefined ? {} : { expected }),
      ...(actual === undefined ? {} : { actual }),
    });
  }

  #commit<T extends Exclude<GameEvent, RejectedGameEvent>>(
    event: Omit<T, 'revision' | 'status'>,
  ): T {
    this.#revision += 1;
    this.#observationCache = undefined;
    return Object.freeze({ ...event, revision: this.#revision, status: this.#status }) as T;
  }
}
