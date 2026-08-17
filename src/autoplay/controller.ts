import { decideAutoplay, type PublicObservation } from './solver';
import { AUTOPLAY_SPEED_DELAYS, type AutoDecision, type AutoplaySpeed } from './types';

export type AutoplayRunState = 'stopped' | 'running' | 'paused';

export interface AutoplayState {
  readonly status: AutoplayRunState;
  readonly speed: AutoplaySpeed;
  readonly reason: string | null;
  readonly lastDecision: AutoDecision | null;
}

export type DecisionExecutionResult =
  void | boolean | { readonly accepted?: boolean; readonly changed?: boolean };

export interface AutoplayControllerOptions {
  readonly observe: () => PublicObservation;
  readonly executeDecision: (
    decision: AutoDecision,
  ) => DecisionExecutionResult | Promise<DecisionExecutionResult>;
  readonly decide?: (observation: PublicObservation) => AutoDecision;
  readonly onStateChange?: (state: AutoplayState) => void;
  readonly onError?: (error: unknown) => void;
  readonly initialSpeed?: AutoplaySpeed;
}

export class AutoplayController {
  readonly #observe: AutoplayControllerOptions['observe'];
  readonly #executeDecision: AutoplayControllerOptions['executeDecision'];
  readonly #decide: NonNullable<AutoplayControllerOptions['decide']>;
  readonly #onStateChange: AutoplayControllerOptions['onStateChange'];
  readonly #onError: AutoplayControllerOptions['onError'];
  #status: AutoplayRunState = 'stopped';
  #speed: AutoplaySpeed;
  #reason: string | null = null;
  #lastDecision: AutoDecision | null = null;
  #timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  #session = 0;
  #invalidFingerprint: string | null = null;
  #invalidCount = 0;

  constructor(options: AutoplayControllerOptions) {
    this.#observe = options.observe;
    this.#executeDecision = options.executeDecision;
    this.#decide = options.decide ?? decideAutoplay;
    this.#onStateChange = options.onStateChange;
    this.#onError = options.onError;
    this.#speed = options.initialSpeed ?? 1;
    assertSpeed(this.#speed);
  }

  get state(): AutoplayState {
    return {
      status: this.#status,
      speed: this.#speed,
      reason: this.#reason,
      lastDecision: this.#lastDecision,
    };
  }

  get delay(): number {
    return AUTOPLAY_SPEED_DELAYS[this.#speed];
  }

  start(): void {
    this.#invalidateTimer();
    this.#status = 'running';
    this.#reason = null;
    this.#lastDecision = null;
    this.#invalidFingerprint = null;
    this.#invalidCount = 0;
    this.#emit();
    this.#schedule();
  }

  pause(reason = 'paused'): void {
    if (this.#status !== 'running') return;
    this.#invalidateTimer();
    this.#status = 'paused';
    this.#reason = reason;
    this.#emit();
  }

  resume(): void {
    if (this.#status !== 'paused') return;
    this.#invalidateTimer();
    this.#status = 'running';
    this.#reason = null;
    this.#emit();
    this.#schedule();
  }

  stop(reason = 'stopped'): void {
    this.#invalidateTimer();
    this.#status = 'stopped';
    this.#reason = reason;
    this.#invalidFingerprint = null;
    this.#invalidCount = 0;
    this.#emit();
  }

  setSpeed(speed: AutoplaySpeed): void {
    assertSpeed(speed);
    if (this.#speed === speed) return;
    this.#speed = speed;
    if (this.#status === 'running') {
      this.#invalidateTimer();
      this.#schedule();
    }
    this.#emit();
  }

  reschedule(): void {
    if (this.#status !== 'running') return;
    this.#invalidateTimer();
    this.#schedule();
  }

  manualIntervention(): void {
    this.stop('manual-intervention');
  }

  visibilityChanged(hidden: boolean): void {
    if (hidden) this.pause('hidden');
  }

  missionReplaced(): void {
    this.stop('mission-replaced');
  }

  dispose(): void {
    this.stop('disposed');
  }

  #schedule(): void {
    if (this.#status !== 'running' || this.#timer !== null) return;
    const session = this.#session;
    this.#timer = globalThis.setTimeout(() => {
      this.#timer = null;
      void this.#tick(session);
    }, this.delay);
  }

  async #tick(session: number): Promise<void> {
    if (!this.#isCurrentSession(session)) return;
    try {
      const observed = this.#observe();
      const decision = this.#decide(observed);
      const latest = this.#observe();
      if (
        !this.#isCurrentSession(session) ||
        decision.expectedRevision !== observed.revision ||
        latest.revision !== decision.expectedRevision
      ) {
        if (this.#isCurrentSession(session)) this.#schedule();
        return;
      }

      this.#lastDecision = decision;
      this.#emit();
      const execution = await this.#executeDecision(decision);
      if (!this.#isCurrentSession(session)) return;
      if (decision.kind === 'stop') {
        this.stop(decision.reason);
        return;
      }

      if (!wasAccepted(execution)) {
        const fingerprint = decisionFingerprint(decision);
        if (fingerprint === this.#invalidFingerprint) {
          this.#invalidCount += 1;
        } else {
          this.#invalidFingerprint = fingerprint;
          this.#invalidCount = 1;
        }
        if (this.#invalidCount >= 2) {
          this.stop('同じ無効操作が繰り返されたため停止しました。');
          return;
        }
      } else {
        this.#invalidFingerprint = null;
        this.#invalidCount = 0;
      }
      this.#schedule();
    } catch (error) {
      if (!this.#isCurrentSession(session)) return;
      this.#onError?.(error);
      this.stop('オートプレイ処理でエラーが発生しました。');
    }
  }

  #isCurrentSession(session: number): boolean {
    return this.#status === 'running' && session === this.#session;
  }

  #invalidateTimer(): void {
    this.#session += 1;
    if (this.#timer !== null) {
      globalThis.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #emit(): void {
    this.#onStateChange?.(this.state);
  }
}

function assertSpeed(speed: number): asserts speed is AutoplaySpeed {
  if (!Object.prototype.hasOwnProperty.call(AUTOPLAY_SPEED_DELAYS, speed)) {
    throw new RangeError(`Unsupported autoplay speed: ${speed}`);
  }
}

function wasAccepted(result: DecisionExecutionResult): boolean {
  if (result === false) return false;
  if (typeof result !== 'object' || result === null) return true;
  if (result.accepted === false) return false;
  return result.changed !== false;
}

function decisionFingerprint(decision: Exclude<AutoDecision, { kind: 'stop' }>): string {
  const targetId = decision.targetId;
  const flagged = decision.kind === 'flag' ? String(decision.flagged) : '';
  return `${decision.kind}:${targetId}:${flagged}`;
}
