import {
  AutoplayController,
  type AutoDecision,
  type AutoplaySpeed,
  type AutoplayState,
} from '../autoplay';
import {
  Minesweeper3D,
  coordinateToId,
  formatCoordinate,
  idToCoordinate,
  isDifficultyId,
  randomSeed,
  type ActionMode,
  type CellObservation,
  type DifficultyId,
  type GameAction,
  type GameEvent,
  type PublicObservation,
} from '../game';
import { collectAppElements, type AppElements } from './elements';
import { describeGameEvent, type GameMessage } from './game-message';
import {
  selectStatusFace,
  selectStatusFailureFace,
  STATUS_FACE_ANIMATION_INTERVAL,
  STATUS_FACE_REACTION_DURATION,
  statusFaceReactionFor,
  type StatusFaceAutoplayOutcome,
  type StatusFaceReaction,
  type StatusFailureFace,
} from './status-face';
import { VictoryCelebration } from './victory-celebration';
import { VoxelBoard, type BoardIntent } from './voxel-board';

const numberFormat = new Intl.NumberFormat('ja-JP');
const maximumLogEntries = 100;
const logFollowThreshold = 24;
const defaultAutoplayComment = '確定できる操作だけを実行し、運ゲーは人間へ引き渡します。';
const analyzingAutoplayComment = 'AIアシストが確定手を解析しています。';

class Hypermines3DApplication {
  readonly #elements: AppElements;
  readonly #listeners = new AbortController();
  readonly #board: VoxelBoard;
  readonly #autoplay: AutoplayController;
  readonly #victoryCelebration: VictoryCelebration;
  readonly #timerHandle: number;
  #game: Minesweeper3D;
  #observation: PublicObservation;
  #actionMode: ActionMode = 'open';
  #pendingDecision: AutoDecision | null = null;
  #autoplayPresentationEpoch = 0;
  #logEntries: GameMessage[] = [{ text: '外側のマスから順に開いてください。', tone: 'info' }];
  #autoplayLogFingerprint: string | null = null;
  #overlayStatus: PublicObservation['status'] = 'ready';
  #timerStartedAt: number | null = null;
  #elapsedMilliseconds = 0;
  #dialogReturnFocus: HTMLElement | null = null;
  #faceReaction: { readonly kind: StatusFaceReaction; readonly expiresAt: number } | null = null;
  #autoplayFaceOutcome: {
    readonly kind: StatusFaceAutoplayOutcome;
    readonly revision: number;
  } | null = null;
  #failureFace: StatusFailureFace | null = null;
  readonly #motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor() {
    this.#elements = collectAppElements();
    const parameters = new URLSearchParams(window.location.search);
    const seed = parseSeed(parameters.get('seed')) ?? randomSeed();
    const requestedDifficulty = parameters.get('level');
    const difficulty: DifficultyId = isDifficultyId(requestedDifficulty)
      ? requestedDifficulty
      : 'beginner';
    this.#game = new Minesweeper3D(seed, difficulty);

    const sharedStart = parseSharedStart(parameters.get('start'), this.#game);
    if (sharedStart !== null && this.#game.isSurfaceCell(sharedStart)) {
      this.#game.apply({ type: 'reveal', cellId: sharedStart });
      this.#timerStartedAt = performance.now();
      this.#logEntries = [
        { text: '共有された最初の一手から同じ盤面を再現しました。', tone: 'info' },
      ];
    }

    this.#observation = this.#game.observe();
    this.#board = new VoxelBoard({
      canvas: this.#elements.voxelCanvas,
      fallback: this.#elements.webglFallback,
      onIntent: (intent) => this.applyBoardIntent(intent),
      onHoverCell: (cell, point) => this.renderTooltip(cell, point),
    });
    this.#victoryCelebration = new VictoryCelebration(this.#elements.victoryCelebrationCanvas);
    this.#autoplay = new AutoplayController({
      observe: () => this.#game.observe(),
      executeDecision: (decision) => this.executeAutoplayDecision(decision),
      onStateChange: (state) => this.handleAutoplayState(state),
      onError: () => {
        this.setMessage('AIアシストの処理中にエラーが発生しました。', 'danger');
      },
    });

    this.#elements.seedInput.value = String(this.#game.seed);
    this.#elements.difficultySelect.value = this.#game.difficultyId;
    this.bindEvents();
    this.#timerHandle = window.setInterval(() => {
      this.renderTimer();
      this.renderStatusFace();
    }, 250);
    this.renderLog();
    this.render();
  }

  destroy(): void {
    window.clearInterval(this.#timerHandle);
    this.#autoplay.dispose();
    this.#victoryCelebration.destroy();
    this.#board.destroy();
    this.#listeners.abort();
  }

  private bindEvents(): void {
    const signal = this.#listeners.signal;
    const elements = this.#elements;
    elements.newGameButton.addEventListener('click', () => this.startFromControls(false), {
      signal,
    });
    elements.randomGameButton.addEventListener('click', () => this.startFromControls(true), {
      signal,
    });
    elements.resultNewGameButton.addEventListener('click', () => this.startFromControls(true), {
      signal,
    });
    elements.seedInput.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter') this.startFromControls(false);
      },
      { signal },
    );

    for (const button of elements.modeButtons) {
      button.addEventListener(
        'click',
        () => {
          const mode = button.dataset.mode;
          if (mode === 'open' || mode === 'flag') this.setActionMode(mode);
        },
        { signal },
      );
    }
    elements.resetCameraButton.addEventListener('click', () => this.#board.resetCamera(), {
      signal,
    });
    elements.copyLinkButton.addEventListener('click', () => void this.copyShareUrl(), { signal });
    elements.autoplayToggleButton.addEventListener('click', () => this.toggleAutoplay(), {
      signal,
    });
    elements.autoplayStopButton.addEventListener(
      'click',
      () => this.#autoplay.stop('ユーザーが停止しました。'),
      { signal },
    );
    elements.autoplaySpeedSelect.addEventListener(
      'change',
      () => {
        const speed = parseAutoplaySpeed(elements.autoplaySpeedSelect.value);
        if (speed !== null) this.#autoplay.setSpeed(speed);
      },
      { signal },
    );

    elements.howToButton.addEventListener('click', () => this.openHowTo(), { signal });
    elements.closeHowToButton.addEventListener('click', () => elements.howToDialog.close(), {
      signal,
    });
    elements.howToDialog.addEventListener('close', () => this.restoreDialogFocus(), { signal });
    elements.howToDialog.addEventListener(
      'click',
      (event) => {
        if (event.target === elements.howToDialog) elements.howToDialog.close();
      },
      { signal },
    );
    elements.closeResultButton.addEventListener('click', () => elements.resultDialog.close(), {
      signal,
    });
    elements.resultDialog.addEventListener(
      'click',
      (event) => {
        if (event.target === elements.resultDialog) elements.resultDialog.close();
      },
      { signal },
    );
    elements.resultDialog.addEventListener('close', () => this.#victoryCelebration.stop(), {
      signal,
    });

    window.addEventListener('keydown', (event) => this.handleKeyboard(event), { signal });
    document.addEventListener(
      'visibilitychange',
      () => this.#autoplay.visibilityChanged(document.hidden),
      { signal },
    );
    window.addEventListener('beforeunload', () => this.destroy(), { signal, once: true });
  }

  private startFromControls(randomize: boolean): void {
    const seed = randomize
      ? randomSeed()
      : (parseSeed(this.#elements.seedInput.value) ?? randomSeed());
    const requested = this.#elements.difficultySelect.value;
    this.startGame(seed, isDifficultyId(requested) ? requested : 'beginner');
  }

  private startGame(seed: number, difficulty: DifficultyId): void {
    this.#autoplay.missionReplaced();
    this.#victoryCelebration.stop();
    this.#game = new Minesweeper3D(seed, difficulty);
    this.#observation = this.#game.observe();
    this.#pendingDecision = null;
    this.#autoplayLogFingerprint = null;
    this.#faceReaction = null;
    this.#autoplayFaceOutcome = null;
    this.#failureFace = null;
    this.#overlayStatus = 'ready';
    this.#timerStartedAt = null;
    this.#elapsedMilliseconds = 0;
    this.resetLog({
      text: '新しい盤面を生成しました。最初のマスと周囲は安全です。',
      tone: 'info',
    });
    this.#elements.seedInput.value = String(this.#game.seed);
    this.#elements.difficultySelect.value = this.#game.difficultyId;
    if (this.#elements.resultDialog.open) this.#elements.resultDialog.close();
    if (this.#elements.howToDialog.open) this.#elements.howToDialog.close();
    this.updateUrl();
    this.#board.resetCamera();
    this.render();
  }

  private applyBoardIntent(intent: BoardIntent): void {
    const action: GameAction =
      intent.type === 'reveal'
        ? { type: 'reveal', cellId: intent.cellId }
        : intent.type === 'toggle-flag'
          ? { type: 'toggle-flag', cellId: intent.cellId }
          : { type: 'chord', cellId: intent.cellId };
    this.applyManualAction(action);
  }

  private applyManualAction(action: GameAction): void {
    if (this.#autoplay.state.status !== 'stopped') {
      this.#autoplay.stop('人間の操作を受けて停止しました。');
    }
    this.#pendingDecision = null;
    this.applyGameAction(action, 'manual');
  }

  private applyGameAction(action: GameAction, source: 'manual' | 'autoplay'): GameEvent {
    const previousStatus = this.#observation.status;
    const event = this.#game.apply(action);
    this.#observation = this.#game.observe();
    if (previousStatus !== 'lost' && this.#observation.status === 'lost') {
      this.#failureFace = selectStatusFailureFace();
    }
    if (source === 'manual') {
      const reaction = statusFaceReactionFor(event);
      this.#faceReaction =
        reaction === null
          ? null
          : { kind: reaction, expiresAt: performance.now() + STATUS_FACE_REACTION_DURATION };
      if (event.changed) {
        this.#autoplayFaceOutcome = null;
        if (this.#observation.status !== 'lost') this.#failureFace = null;
      }
    }
    this.appendLog(describeGameEvent(event, this.#observation));
    if (event.type === 'revealed' && event.started) {
      this.#timerStartedAt = performance.now();
      this.updateUrl();
    }
    if (this.#observation.status === 'won' || this.#observation.status === 'lost') {
      this.stopTimer();
    }
    this.render();
    return event;
  }

  private setActionMode(mode: ActionMode): void {
    this.#actionMode = mode;
    this.#board.setActionMode(mode);
    for (const button of this.#elements.modeButtons) {
      const active = button.dataset.mode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    this.renderStatusFace();
  }

  private handleKeyboard(event: KeyboardEvent): void {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      this.#elements.howToDialog.open ||
      this.#elements.resultDialog.open
    ) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case '1':
        this.setActionMode('open');
        break;
      case '2':
        this.setActionMode('flag');
        break;
      case 'r':
        this.startFromControls(false);
        break;
      case '?':
        this.openHowTo();
        break;
    }
  }

  private toggleAutoplay(): void {
    const state = this.#autoplay.state.status;
    if (state === 'running') this.#autoplay.pause('ユーザーが一時停止しました。');
    else if (state === 'paused') this.#autoplay.resume();
    else if (this.#observation.status === 'won' || this.#observation.status === 'lost') {
      this.setMessage('終了した盤面ではAIアシストを開始できません。', 'warning');
    } else {
      this.#autoplay.start();
    }
  }

  private async executeAutoplayDecision(
    decision: AutoDecision,
  ): Promise<{ readonly accepted: boolean; readonly changed: boolean }> {
    const presentationEpoch = this.#autoplayPresentationEpoch;
    if (decision.kind === 'stop') {
      return { accepted: true, changed: true };
    }

    this.#pendingDecision = decision;
    this.renderAutoplay();
    this.renderStatusFace();
    this.#board.update(this.#observation, decision.targetId);
    await wait(Math.min(220, Math.max(80, Math.round(this.#autoplay.delay * 0.18))));
    if (!this.isCurrentAutoplayPresentation(presentationEpoch, decision.expectedRevision)) {
      this.clearAutoplayPresentation(presentationEpoch);
      return { accepted: false, changed: false };
    }

    const action: GameAction =
      decision.kind === 'reveal'
        ? { type: 'reveal', cellId: decision.targetId }
        : decision.kind === 'flag'
          ? { type: 'toggle-flag', cellId: decision.targetId }
          : { type: 'chord', cellId: decision.targetId };
    const event = this.applyGameAction(action, 'autoplay');
    this.clearAutoplayPresentation(presentationEpoch);
    if (this.#observation.status === 'won' || this.#observation.status === 'lost') {
      this.#autoplay.stop(
        this.#observation.status === 'won' ? '全てのマスを開きました！' : '地雷が爆発しました。',
      );
    }
    return { accepted: event.changed, changed: event.changed };
  }

  private isCurrentAutoplayPresentation(epoch: number, expectedRevision: number): boolean {
    return (
      epoch === this.#autoplayPresentationEpoch &&
      this.#autoplay.state.status === 'running' &&
      this.#game.revision === expectedRevision
    );
  }

  private clearAutoplayPresentation(epoch: number): void {
    if (epoch !== this.#autoplayPresentationEpoch) return;
    this.#pendingDecision = null;
    this.renderAutoplay();
    this.renderStatusFace();
    this.#board.update(this.#observation, null);
  }

  private handleAutoplayState(state: AutoplayState): void {
    this.#autoplayPresentationEpoch += 1;
    this.#pendingDecision = null;
    if (state.status === 'running') {
      this.#faceReaction = null;
      this.#autoplayFaceOutcome = null;
      if (this.#observation.status !== 'lost') this.#failureFace = null;
    } else {
      const outcome = autoplayFaceOutcomeFor(state);
      if (outcome !== null) {
        const sameOutcome =
          this.#autoplayFaceOutcome?.kind === outcome &&
          this.#autoplayFaceOutcome.revision === this.#observation.revision;
        this.#autoplayFaceOutcome = { kind: outcome, revision: this.#observation.revision };
        if (isAutoplayFailureOutcome(outcome)) {
          if (!sameOutcome) this.#failureFace = selectStatusFailureFace();
        } else {
          this.#failureFace = null;
        }
      }
    }
    const fingerprint = `${state.status}:${state.reason ?? ''}`;
    if (fingerprint !== this.#autoplayLogFingerprint) {
      this.#autoplayLogFingerprint = fingerprint;
      const message = describeAutoplayState(state);
      if (message !== null) this.appendLog(message);
    }
    this.renderAutoplay();
    this.renderStatusFace();
    this.#board.update(this.#observation, decisionTargetId(this.#pendingDecision));
  }

  private render(): void {
    this.#observation = this.#game.observe();
    this.renderMetrics();
    this.renderTimer();
    this.renderAutoplay();
    this.renderStatusFace();
    this.renderResult();
    this.#board.setActionMode(this.#actionMode);
    this.#board.update(this.#observation, decisionTargetId(this.#pendingDecision));
  }

  private renderMetrics(): void {
    const observation = this.#observation;
    const statusLabels = {
      ready: ['準備中', '外側のマスを開く'],
      playing: ['プレイ中', `開けるマス ${surfaceCount(observation)}`],
      won: ['クリア', '全てのマスを開きました！'],
      lost: ['ゲームオーバー', '地雷が爆発'],
    } as const;
    const [status, detail] = statusLabels[observation.status];
    this.#elements.statusMetric.textContent = status;
    this.#elements.statusDetail.textContent = detail;
    this.#elements.newGameButton.dataset.status = observation.status;
    this.#elements.minesMetric.textContent = String(observation.remainingMines).padStart(3, '0');
    this.#elements.flagsMetric.textContent = `旗 ${observation.flagCount} / ${observation.mineCount}`;
    const progress = Math.round(observation.progress * 100);
    this.#elements.progressMetric.textContent = `${progress}%`;
    this.#elements.progressBar.value = progress;
    this.#elements.progressBar.textContent = `${progress}%`;
    this.#elements.openedMetric.textContent = `${numberFormat.format(observation.revealedCount)} / ${numberFormat.format(observation.safeCellCount)} マス`;
  }

  private renderTimer(): void {
    this.#elements.timeMetric.textContent = formatDuration(this.elapsedMilliseconds());
  }

  private renderStatusFace(): void {
    const now = performance.now();
    if (this.#faceReaction !== null && this.#faceReaction.expiresAt <= now) {
      this.#faceReaction = null;
    }
    const pendingDecision = this.#pendingDecision;
    const autoplayActivity =
      pendingDecision === null || pendingDecision.kind === 'stop'
        ? 'analyzing'
        : pendingDecision.kind;
    const autoplayOutcome =
      this.#autoplayFaceOutcome?.revision === this.#observation.revision
        ? this.#autoplayFaceOutcome.kind
        : null;
    this.#elements.statusFace.textContent = selectStatusFace({
      gameStatus: this.#observation.status,
      progress: this.#observation.progress,
      remainingMines: this.#observation.remainingMines,
      actionMode: this.#actionMode,
      autoplayStatus: this.#autoplay.state.status,
      autoplayActivity,
      autoplayOutcome,
      failureFace: this.#failureFace,
      reaction: this.#faceReaction?.kind ?? null,
      animationFrame: Math.floor(now / STATUS_FACE_ANIMATION_INTERVAL),
      reducedMotion: this.#motionPreference.matches,
    });
  }

  private renderAutoplay(): void {
    const state = this.#autoplay.state;
    const labels = { stopped: '停止中', running: '実行中', paused: '一時停止' } as const;
    this.#elements.autoplayStatus.textContent = labels[state.status];
    this.#elements.autoplayToggleButton.setAttribute(
      'aria-pressed',
      String(state.status !== 'stopped'),
    );
    this.#elements.autoplayToggleButton.innerHTML =
      state.status === 'running'
        ? '<span aria-hidden="true">Ⅱ</span> 一時停止'
        : state.status === 'paused'
          ? '<span aria-hidden="true">▶</span> 再開'
          : '<span aria-hidden="true">▶</span> AIアシスト';
    this.#elements.autoplayStopButton.disabled = state.status === 'stopped';
    this.#elements.autoplayReason.textContent =
      this.#pendingDecision?.reason ??
      (state.status === 'running'
        ? analyzingAutoplayComment
        : (describeAutoplayReason(state.reason) ?? defaultAutoplayComment));
  }

  private renderResult(): void {
    const status = this.#observation.status;
    if (status === 'ready' || status === 'playing' || status === this.#overlayStatus) return;
    this.#overlayStatus = status;
    const won = status === 'won';
    this.#elements.resultKicker.textContent = won ? 'GAME CLEAR' : 'GAME OVER';
    this.#elements.resultTitle.textContent = won ? 'congratulations!' : 'GAME OVER';
    this.#elements.resultText.textContent = won
      ? '全てのマスを開きました！'
      : '地雷を開きました。盤面を回転して位置を確認できます。';
    this.#elements.resultStats.replaceChildren(
      createResultStat('時間', formatDuration(this.elapsedMilliseconds())),
      createResultStat('開いたマス', numberFormat.format(this.#observation.revealedCount)),
      createResultStat('旗', `${this.#observation.flagCount}/${this.#observation.mineCount}`),
      createResultStat('SEED', String(this.#game.seed)),
    );
    if (!this.#elements.resultDialog.open) this.#elements.resultDialog.showModal();
    if (won) this.#victoryCelebration.play();
    else this.#victoryCelebration.stop();
  }

  private renderTooltip(cell: CellObservation | null, point: { x: number; y: number }): void {
    const tooltip = this.#elements.cellTooltip;
    if (cell === null) {
      tooltip.hidden = true;
      return;
    }
    const stateLabels: Readonly<Record<CellObservation['state'], string>> = {
      covered: '閉じたマス',
      revealed: `数字 ${cell.clue}`,
      flagged: '旗',
      mine: '地雷',
      detonated: '爆発した地雷',
      'wrong-flag': '誤った旗',
    };
    tooltip.textContent = `${formatCoordinate(cell.coordinate)} · ${stateLabels[cell.state]}`;
    const stage = this.#elements.voxelCanvas.parentElement!.getBoundingClientRect();
    tooltip.style.left = `${Math.max(10, Math.min(stage.width - 190, point.x - stage.left + 14))}px`;
    tooltip.style.top = `${Math.max(10, Math.min(stage.height - 44, point.y - stage.top + 14))}px`;
    tooltip.hidden = false;
  }

  private openHowTo(): void {
    if (this.#autoplay.state.status === 'running') {
      this.#autoplay.pause('遊び方を表示したため一時停止しました。');
    }
    this.#dialogReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : this.#elements.howToButton;
    if (!this.#elements.howToDialog.open) this.#elements.howToDialog.showModal();
  }

  private restoreDialogFocus(): void {
    const target = this.#dialogReturnFocus;
    this.#dialogReturnFocus = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  private async copyShareUrl(): Promise<void> {
    this.updateUrl();
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.setMessage('同じ盤面を再現する共有URLをコピーしました。', 'success');
    } catch {
      this.setMessage(
        'URLをコピーできませんでした。アドレスバーからコピーしてください。',
        'warning',
      );
    }
  }

  private updateUrl(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(this.#game.seed));
    url.searchParams.set('level', this.#game.difficultyId);
    if (this.#game.firstRevealId === null) {
      url.searchParams.delete('start');
    } else {
      const coordinate = idToCoordinate(this.#game.firstRevealId, this.#game.dimensions);
      url.searchParams.set('start', `${coordinate.x + 1}-${coordinate.y + 1}-${coordinate.z + 1}`);
    }
    window.history.replaceState(null, '', url);
  }

  private stopTimer(): void {
    if (this.#timerStartedAt === null) return;
    this.#elapsedMilliseconds += performance.now() - this.#timerStartedAt;
    this.#timerStartedAt = null;
  }

  private elapsedMilliseconds(): number {
    return (
      this.#elapsedMilliseconds +
      (this.#timerStartedAt === null ? 0 : performance.now() - this.#timerStartedAt)
    );
  }

  private setMessage(text: string, tone: GameMessage['tone']): void {
    this.appendLog({ text, tone });
  }

  private appendLog(message: GameMessage): void {
    const previous = this.#logEntries[0];
    if (previous?.text === message.text && previous.tone === message.tone) return;
    const log = this.#elements.gameLog;
    const followsLatest = log.scrollTop <= logFollowThreshold;
    const entry = createLogEntry(message);
    this.#logEntries.unshift(message);
    log.prepend(entry);
    while (this.#logEntries.length > maximumLogEntries) {
      this.#logEntries.pop();
      log.lastElementChild?.remove();
    }
    if (followsLatest) log.scrollTop = 0;
    else log.scrollTop += entry.offsetHeight;
  }

  private resetLog(message: GameMessage): void {
    this.#logEntries = [message];
    this.renderLog();
  }

  private renderLog(): void {
    const log = this.#elements.gameLog;
    log.replaceChildren(...this.#logEntries.map(createLogEntry));
    log.scrollTop = 0;
  }
}

function parseSharedStart(value: string | null, game: Minesweeper3D): number | null {
  if (value === null) return null;
  const values = value.split('-').map((part) => Number(part) - 1);
  if (values.length !== 3 || values.some((part) => !Number.isInteger(part))) return null;
  try {
    return coordinateToId({ x: values[0]!, y: values[1]!, z: values[2]! }, game.dimensions);
  } catch {
    return null;
  }
}

function parseSeed(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed >>> 0 : null;
}

function parseAutoplaySpeed(value: string): AutoplaySpeed | null {
  const parsed = Number(value);
  return parsed === 0.5 || parsed === 1 || parsed === 2 ? parsed : null;
}

function decisionTargetId(decision: AutoDecision | null): number | null {
  return decision !== null && decision.kind !== 'stop' ? decision.targetId : null;
}

function autoplayFaceOutcomeFor(state: AutoplayState): StatusFaceAutoplayOutcome | null {
  if (state.status !== 'stopped') return null;
  const decision = state.lastDecision;
  if (decision?.kind === 'stop' && decision.reason === state.reason) {
    if (
      decision.stopReason === 'needs-human' ||
      decision.stopReason === 'contradiction' ||
      decision.stopReason === 'invalid-observation'
    ) {
      return decision.stopReason;
    }
  }
  if (state.reason?.includes('エラー') || state.reason?.includes('無効操作')) return 'error';
  return null;
}

function isAutoplayFailureOutcome(outcome: StatusFaceAutoplayOutcome): boolean {
  return outcome !== 'needs-human';
}

function describeAutoplayReason(reason: string | null): string | null {
  switch (reason) {
    case null:
    case 'mission-replaced':
    case 'disposed':
      return null;
    case 'hidden':
      return '画面が非表示になったため、AIアシストを一時停止しました。';
    case 'manual-intervention':
      return '人間の操作を受けて停止しました。';
    case 'paused':
      return 'AIアシストを一時停止しました。';
    case 'stopped':
      return 'AIアシストを停止しました。';
    default:
      return reason;
  }
}

function describeAutoplayState(state: AutoplayState): GameMessage | null {
  if (state.status === 'running') return null;
  const text = describeAutoplayReason(state.reason);
  if (text === null) return null;
  const tone = text.includes('全てのマス')
    ? 'success'
    : text.includes('エラー') || text.includes('無効操作') || text.includes('地雷が爆発')
      ? 'danger'
      : text.includes('運ゲー') || state.status === 'paused'
        ? 'warning'
        : 'info';
  return { text, tone };
}

function surfaceCount(observation: PublicObservation): number {
  return observation.cells.filter((cell) => cell.state === 'covered' && cell.isSurface).length;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function createResultStat(label: string, value: string): HTMLElement {
  const element = document.createElement('span');
  const labelElement = document.createElement('small');
  labelElement.textContent = label;
  const valueElement = document.createElement('strong');
  valueElement.textContent = value;
  element.append(labelElement, valueElement);
  return element;
}

function createLogEntry(message: GameMessage): HTMLLIElement {
  const entry = document.createElement('li');
  entry.className = 'game-log-entry';
  entry.dataset.tone = message.tone;
  entry.textContent = message.text;
  return entry;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function initialize(): void {
  new Hypermines3DApplication();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
