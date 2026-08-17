export const AUTOPLAY_SPEED_DELAYS = Object.freeze({
  0.5: 1_400,
  1: 800,
  2: 400,
} as const);

export type AutoplaySpeed = keyof typeof AUTOPLAY_SPEED_DELAYS;

export interface DecisionContext {
  readonly expectedRevision: number;
  readonly reason: string;
}

export interface RevealDecision extends DecisionContext {
  readonly kind: 'reveal';
  readonly targetId: number;
}

export interface FlagDecision extends DecisionContext {
  readonly kind: 'flag';
  readonly targetId: number;
  readonly flagged: boolean;
}

export interface ChordDecision extends DecisionContext {
  readonly kind: 'chord';
  readonly targetId: number;
}

export type StopReason = 'won' | 'lost' | 'needs-human' | 'contradiction' | 'invalid-observation';

export interface StopDecision extends DecisionContext {
  readonly kind: 'stop';
  readonly stopReason: StopReason;
}

export type AutoDecision = RevealDecision | FlagDecision | ChordDecision | StopDecision;

export interface ConstraintSnapshot {
  readonly cells: readonly number[];
  readonly mines: number;
  readonly sourceId: number;
  readonly direction: 'observed' | 'derived';
}

export interface AnalysisResult {
  readonly contradiction: string | null;
  readonly safe: ReadonlySet<number>;
  readonly mines: ReadonlySet<number>;
  readonly constraints: readonly ConstraintSnapshot[];
  readonly frontier: ReadonlySet<number>;
  readonly truncatedComponents: number;
}
