import type { AnalysisResult, AutoDecision } from './types';

interface BoardDimensions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

interface PublicCell {
  readonly id: number;
  readonly coordinate: Readonly<{ x: number; y: number; z: number }>;
  readonly state: 'covered' | 'revealed' | 'flagged' | 'mine' | 'detonated' | 'wrong-flag';
  readonly clue: number | null;
  readonly isSurface: boolean;
}

export interface PublicObservation {
  readonly revision: number;
  readonly status: 'ready' | 'playing' | 'won' | 'lost';
  readonly dimensions: BoardDimensions;
  readonly mineCount: number;
  readonly remainingMines: number;
  readonly flagCount: number;
  readonly cells: readonly PublicCell[];
}

const MAX_COMPONENT_VARIABLES = 22;
const MAX_ENUMERATION_NODES = 200_000;

interface Constraint {
  readonly cells: readonly number[];
  readonly mines: number;
  readonly sourceId: number;
  readonly direction: 'observed' | 'derived';
}

interface ReductionResult {
  readonly constraints: readonly Constraint[];
  readonly safe: Set<number>;
  readonly mines: Set<number>;
  readonly contradiction: string | null;
}

interface EnumerationResult {
  readonly complete: boolean;
  readonly solutionCount: number;
  readonly alwaysSafe: ReadonlySet<number>;
  readonly alwaysMine: ReadonlySet<number>;
}

export function analyzeObservation(observation: PublicObservation): AnalysisResult {
  const validationError = validateObservation(observation);
  if (validationError !== null) return emptyAnalysis(`invalid:${validationError}`);

  const safe = new Set<number>();
  const mines = new Set<number>();
  const covered = new Set<number>();
  for (const cell of observation.cells) {
    if (cell.state === 'revealed') safe.add(cell.id);
    else if (cell.state === 'flagged') mines.add(cell.id);
    else if (cell.state === 'covered') covered.add(cell.id);
  }

  if (observation.remainingMines < 0 || observation.remainingMines > covered.size) {
    return emptyAnalysis('残り地雷数と未確定マス数が矛盾しています。');
  }
  if (observation.remainingMines === 0) {
    for (const id of covered) safe.add(id);
  } else if (observation.remainingMines === covered.size) {
    for (const id of covered) mines.add(id);
  }

  const initial: Constraint[] = [];
  for (const cell of observation.cells) {
    if (cell.state !== 'revealed' || cell.clue === null) continue;
    const neighbors = neighborIds(cell.id, observation.dimensions);
    const flagged = neighbors.filter((id) => mines.has(id)).length;
    const unknown = neighbors.filter((id) => covered.has(id) && !safe.has(id) && !mines.has(id));
    const remaining = cell.clue - flagged;
    if (remaining < 0 || remaining > unknown.length) {
      return emptyAnalysis(`マス ${formatId(cell.id)} の旗と手掛かりが矛盾しています。`);
    }
    if (unknown.length > 0) {
      initial.push(createConstraint(unknown, remaining, cell.id, 'observed'));
    } else if (remaining !== 0) {
      return emptyAnalysis(`マス ${formatId(cell.id)} の周囲に未確定マスがありません。`);
    }
  }

  let reduced = reduceConstraints(initial, safe, mines);
  if (reduced.contradiction !== null) {
    return {
      contradiction: reduced.contradiction,
      safe: reduced.safe,
      mines: reduced.mines,
      constraints: reduced.constraints,
      frontier: collectFrontier(initial),
      truncatedComponents: 0,
    };
  }

  let truncatedComponents = 0;
  let learned = true;
  while (learned) {
    learned = false;
    const components = createConstraintComponents(reduced.constraints);
    for (const component of components) {
      if (component.cells.length > MAX_COMPONENT_VARIABLES) {
        truncatedComponents += 1;
        continue;
      }
      const enumeration = enumerateComponent(component.cells, component.constraints);
      if (!enumeration.complete) {
        truncatedComponents += 1;
        continue;
      }
      if (enumeration.solutionCount === 0) {
        return {
          contradiction: '観測された手掛かりを同時に満たす地雷配置がありません。',
          safe: reduced.safe,
          mines: reduced.mines,
          constraints: reduced.constraints,
          frontier: collectFrontier(initial),
          truncatedComponents,
        };
      }
      for (const id of enumeration.alwaysSafe) {
        if (!reduced.safe.has(id)) {
          reduced.safe.add(id);
          learned = true;
        }
      }
      for (const id of enumeration.alwaysMine) {
        if (!reduced.mines.has(id)) {
          reduced.mines.add(id);
          learned = true;
        }
      }
    }
    if (learned) {
      reduced = reduceConstraints(initial, reduced.safe, reduced.mines);
      if (reduced.contradiction !== null) break;
    }
  }

  return {
    contradiction: reduced.contradiction,
    safe: reduced.safe,
    mines: reduced.mines,
    constraints: reduced.constraints,
    frontier: collectFrontier(initial),
    truncatedComponents,
  };
}

export function decideAutoplay(observation: PublicObservation): AutoDecision {
  const context = { expectedRevision: observation.revision };
  if (observation.status === 'won') {
    return stopDecision(context, 'won', '全てのマスを開きました！');
  }
  if (observation.status === 'lost') {
    return stopDecision(context, 'lost', '地雷が爆発し、ゲームが終了しました。');
  }

  if (observation.status === 'ready') {
    const target = pickInitialSurfaceCell(observation);
    if (target === null) {
      return stopDecision(context, 'invalid-observation', '最初に選べる外側のマスがありません。');
    }
    return {
      ...context,
      kind: 'reveal',
      targetId: target,
      reason: '最初の一手と周囲の安全が保証された手前中央のマスを開きます。',
    };
  }

  const analysis = analyzeObservation(observation);
  if (analysis.contradiction !== null) {
    const invalid = analysis.contradiction.startsWith('invalid:');
    return stopDecision(
      context,
      invalid ? 'invalid-observation' : 'contradiction',
      invalid ? analysis.contradiction.slice('invalid:'.length) : analysis.contradiction,
    );
  }

  const cells = new Map(observation.cells.map((cell) => [cell.id, cell]));
  const mineTarget = [...analysis.mines]
    .map((id) => cells.get(id))
    .filter((cell) => cell?.state === 'covered' && cell.isSurface)
    .sort((left, right) => left!.id - right!.id)[0];
  if (mineTarget !== undefined) {
    return {
      ...context,
      kind: 'flag',
      targetId: mineTarget.id,
      flagged: true,
      reason: `${formatId(mineTarget.id)} はすべての整合する配置で地雷です。`,
    };
  }

  const chordTarget = observation.cells
    .filter((cell) => cell.state === 'revealed' && cell.clue !== null && cell.clue > 0)
    .find((cell) => {
      const neighbors = neighborIds(cell.id, observation.dimensions);
      const flags = neighbors.filter((id) => cells.get(id)?.state === 'flagged').length;
      const targets = neighbors.filter((id) => cells.get(id)?.state === 'covered').length;
      return flags === cell.clue && targets > 0;
    });
  if (chordTarget !== undefined) {
    return {
      ...context,
      kind: 'chord',
      targetId: chordTarget.id,
      reason: `${formatId(chordTarget.id)} の手掛かりと旗が一致したため周囲を開きます。`,
    };
  }

  const safeTarget = [...analysis.safe]
    .map((id) => cells.get(id))
    .filter((cell) => cell?.state === 'covered' && cell.isSurface)
    .sort((left, right) => {
      const leftInformation = coveredNeighborCount(left!.id, observation);
      const rightInformation = coveredNeighborCount(right!.id, observation);
      return rightInformation - leftInformation || left!.id - right!.id;
    })[0];
  if (safeTarget !== undefined) {
    return {
      ...context,
      kind: 'reveal',
      targetId: safeTarget.id,
      reason: `${formatId(safeTarget.id)} はすべての整合する配置で安全です。`,
    };
  }

  return stopDecision(
    context,
    'needs-human',
    '確定手がありません。ここからの運ゲーは人間が一手担当してください。',
  );
}

function reduceConstraints(
  initial: readonly Constraint[],
  initialSafe: ReadonlySet<number>,
  initialMines: ReadonlySet<number>,
): ReductionResult {
  const safe = new Set(initialSafe);
  const mines = new Set(initialMines);
  let constraints = [...initial];
  let changed = true;
  while (changed) {
    changed = false;
    const normalized = new Map<string, Constraint>();
    for (const constraint of constraints) {
      let remainingMines = constraint.mines;
      const remainingCells: number[] = [];
      for (const id of constraint.cells) {
        if (mines.has(id)) remainingMines -= 1;
        else if (!safe.has(id)) remainingCells.push(id);
      }
      if (remainingMines < 0 || remainingMines > remainingCells.length) {
        return {
          constraints: Object.freeze([...normalized.values()]),
          safe,
          mines,
          contradiction: `マス ${formatId(constraint.sourceId)} の制約が矛盾しています。`,
        };
      }
      if (remainingCells.length === 0) continue;
      if (remainingMines === 0) {
        for (const id of remainingCells) {
          if (!safe.has(id)) {
            safe.add(id);
            changed = true;
          }
        }
        continue;
      }
      if (remainingMines === remainingCells.length) {
        for (const id of remainingCells) {
          if (!mines.has(id)) {
            mines.add(id);
            changed = true;
          }
        }
        continue;
      }
      const next = createConstraint(
        remainingCells,
        remainingMines,
        constraint.sourceId,
        constraint.direction,
      );
      const key = constraintKey(next.cells);
      const existing = normalized.get(key);
      if (existing !== undefined && existing.mines !== next.mines) {
        return {
          constraints: Object.freeze([...normalized.values()]),
          safe,
          mines,
          contradiction: '同じマスの組み合わせに異なる地雷数が要求されています。',
        };
      }
      normalized.set(key, next);
    }
    constraints = [...normalized.values()];
    if (changed) continue;

    const derived: Constraint[] = [];
    for (let leftIndex = 0; leftIndex < constraints.length; leftIndex += 1) {
      for (let rightIndex = 0; rightIndex < constraints.length; rightIndex += 1) {
        if (leftIndex === rightIndex) continue;
        const subset = constraints[leftIndex]!;
        const superset = constraints[rightIndex]!;
        const difference = subtractSubset(superset.cells, subset.cells);
        if (difference === null || difference.length === 0) continue;
        const mineDifference = superset.mines - subset.mines;
        if (mineDifference < 0 || mineDifference > difference.length) {
          return {
            constraints: Object.freeze(constraints),
            safe,
            mines,
            contradiction: '包含関係から導いた制約が矛盾しています。',
          };
        }
        const next = createConstraint(difference, mineDifference, superset.sourceId, 'derived');
        const key = constraintKey(next.cells);
        if (!constraints.some((constraint) => constraintKey(constraint.cells) === key)) {
          derived.push(next);
        }
      }
    }
    if (derived.length > 0) {
      constraints.push(...derived);
      changed = true;
    }
  }
  return { constraints: Object.freeze(constraints), safe, mines, contradiction: null };
}

function createConstraintComponents(constraints: readonly Constraint[]): Array<{
  readonly cells: readonly number[];
  readonly constraints: readonly Constraint[];
}> {
  const byCell = new Map<number, Constraint[]>();
  for (const constraint of constraints) {
    for (const id of constraint.cells) {
      const bucket = byCell.get(id) ?? [];
      bucket.push(constraint);
      byCell.set(id, bucket);
    }
  }
  const remaining = new Set(byCell.keys());
  const components = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value as number;
    const queue = [first];
    const cells = new Set<number>();
    const componentConstraints = new Set<Constraint>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (cells.has(id)) continue;
      cells.add(id);
      remaining.delete(id);
      for (const constraint of byCell.get(id) ?? []) {
        componentConstraints.add(constraint);
        for (const linked of constraint.cells) {
          if (!cells.has(linked)) queue.push(linked);
        }
      }
    }
    components.push({
      cells: Object.freeze([...cells]),
      constraints: Object.freeze([...componentConstraints]),
    });
  }
  return components;
}

function enumerateComponent(
  componentCells: readonly number[],
  constraints: readonly Constraint[],
): EnumerationResult {
  const frequencies = new Map<number, number>();
  for (const constraint of constraints) {
    for (const id of constraint.cells) frequencies.set(id, (frequencies.get(id) ?? 0) + 1);
  }
  const cells = [...componentCells].sort(
    (left, right) => (frequencies.get(right) ?? 0) - (frequencies.get(left) ?? 0) || left - right,
  );
  const assignment = new Map<number, boolean>();
  const mineOccurrences = new Map(cells.map((id) => [id, 0]));
  let solutionCount = 0;
  let nodes = 0;
  let complete = true;

  const search = (index: number): void => {
    if (!complete) return;
    nodes += 1;
    if (nodes > MAX_ENUMERATION_NODES) {
      complete = false;
      return;
    }
    if (index === cells.length) {
      solutionCount += 1;
      for (const id of cells) {
        if (assignment.get(id)) mineOccurrences.set(id, mineOccurrences.get(id)! + 1);
      }
      return;
    }
    const id = cells[index]!;
    for (const mine of [false, true]) {
      assignment.set(id, mine);
      if (constraintsRemainPossible(constraints, assignment)) search(index + 1);
      assignment.delete(id);
      if (!complete) return;
    }
  };
  search(0);

  const alwaysSafe = new Set<number>();
  const alwaysMine = new Set<number>();
  if (complete && solutionCount > 0) {
    for (const id of cells) {
      const count = mineOccurrences.get(id)!;
      if (count === 0) alwaysSafe.add(id);
      else if (count === solutionCount) alwaysMine.add(id);
    }
  }
  return { complete, solutionCount, alwaysSafe, alwaysMine };
}

function constraintsRemainPossible(
  constraints: readonly Constraint[],
  assignment: ReadonlyMap<number, boolean>,
): boolean {
  for (const constraint of constraints) {
    let assignedMines = 0;
    let unassigned = 0;
    for (const id of constraint.cells) {
      const value = assignment.get(id);
      if (value === undefined) unassigned += 1;
      else if (value) assignedMines += 1;
    }
    if (assignedMines > constraint.mines || assignedMines + unassigned < constraint.mines) {
      return false;
    }
  }
  return true;
}

function validateObservation(observation: PublicObservation): string | null {
  const expectedCells = boardCellCount(observation.dimensions);
  if (observation.cells.length !== expectedCells) return '盤面のマス数が寸法と一致しません。';
  const ids = new Set<number>();
  let flags = 0;
  for (const cell of observation.cells) {
    if (!Number.isInteger(cell.id) || cell.id < 0 || cell.id >= expectedCells || ids.has(cell.id)) {
      return 'マスIDが範囲外または重複しています。';
    }
    ids.add(cell.id);
    if (cell.state === 'flagged') flags += 1;
    if (
      cell.state === 'revealed' &&
      (cell.clue === null || !Number.isInteger(cell.clue) || cell.clue < 0 || cell.clue > 26)
    ) {
      return `マス ${formatId(cell.id)} の手掛かりが不正です。`;
    }
  }
  if (flags !== observation.flagCount) return '旗数がマスの状態と一致しません。';
  return null;
}

function pickInitialSurfaceCell(observation: PublicObservation): number | null {
  const centerX = (observation.dimensions.width - 1) / 2;
  const centerY = (observation.dimensions.height - 1) / 2;
  const frontZ = observation.dimensions.depth - 1;
  return (
    observation.cells
      .filter((cell) => cell.state === 'covered' && cell.isSurface)
      .sort((left, right) => {
        const leftScore =
          Math.abs(left.coordinate.z - frontZ) * 100 +
          (left.coordinate.x - centerX) ** 2 +
          (left.coordinate.y - centerY) ** 2;
        const rightScore =
          Math.abs(right.coordinate.z - frontZ) * 100 +
          (right.coordinate.x - centerX) ** 2 +
          (right.coordinate.y - centerY) ** 2;
        return leftScore - rightScore || left.id - right.id;
      })[0]?.id ?? null
  );
}

function coveredNeighborCount(id: number, observation: PublicObservation): number {
  const states = new Map(observation.cells.map((cell) => [cell.id, cell.state]));
  return neighborIds(id, observation.dimensions).filter(
    (neighborId) => states.get(neighborId) === 'covered',
  ).length;
}

function collectFrontier(constraints: readonly Constraint[]): ReadonlySet<number> {
  return new Set(constraints.flatMap((constraint) => constraint.cells));
}

function createConstraint(
  cells: readonly number[],
  mines: number,
  sourceId: number,
  direction: Constraint['direction'],
): Constraint {
  return Object.freeze({
    cells: Object.freeze([...new Set(cells)].sort((left, right) => left - right)),
    mines,
    sourceId,
    direction,
  });
}

function subtractSubset(superset: readonly number[], subset: readonly number[]): number[] | null {
  const supersetValues = new Set(superset);
  if (!subset.every((id) => supersetValues.has(id))) return null;
  const subsetValues = new Set(subset);
  return superset.filter((id) => !subsetValues.has(id));
}

function constraintKey(cells: readonly number[]): string {
  return cells.join(',');
}

function stopDecision(
  context: { readonly expectedRevision: number },
  stopReason: Extract<AutoDecision, { kind: 'stop' }>['stopReason'],
  reason: string,
): AutoDecision {
  return { ...context, kind: 'stop', stopReason, reason };
}

function emptyAnalysis(contradiction: string): AnalysisResult {
  return {
    contradiction,
    safe: new Set(),
    mines: new Set(),
    constraints: Object.freeze([]),
    frontier: new Set(),
    truncatedComponents: 0,
  };
}

function formatId(id: number): string {
  return `#${String(id).padStart(3, '0')}`;
}

export const AUTOPLAY_SOLVER_LIMITS = Object.freeze({
  maxComponentVariables: MAX_COMPONENT_VARIABLES,
  maxEnumerationNodes: MAX_ENUMERATION_NODES,
});

function boardCellCount(dimensions: BoardDimensions): number {
  return dimensions.width * dimensions.height * dimensions.depth;
}

function neighborIds(id: number, dimensions: BoardDimensions): readonly number[] {
  const layerSize = dimensions.width * dimensions.height;
  const z = Math.floor(id / layerSize);
  const remainder = id - z * layerSize;
  const y = Math.floor(remainder / dimensions.width);
  const x = remainder - y * dimensions.width;
  const neighbors: number[] = [];
  for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        if (xOffset === 0 && yOffset === 0 && zOffset === 0) continue;
        const nextX = x + xOffset;
        const nextY = y + yOffset;
        const nextZ = z + zOffset;
        if (
          nextX >= 0 &&
          nextX < dimensions.width &&
          nextY >= 0 &&
          nextY < dimensions.height &&
          nextZ >= 0 &&
          nextZ < dimensions.depth
        ) {
          neighbors.push(nextX + dimensions.width * (nextY + dimensions.height * nextZ));
        }
      }
    }
  }
  return neighbors;
}
