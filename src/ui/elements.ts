type ElementConstructor<T extends Element> = new () => T;

function requireElement<T extends Element>(id: string, constructor: ElementConstructor<T>): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`Expected #${id} to be a ${constructor.name}`);
  }
  return element;
}

function requireModeButtons(): readonly HTMLButtonElement[] {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.mode-button[data-mode]'),
  );
  if (buttons.length !== 2) throw new Error('Expected two action mode buttons');
  return buttons;
}

export interface AppElements {
  readonly seedInput: HTMLInputElement;
  readonly difficultySelect: HTMLSelectElement;
  readonly newGameButton: HTMLButtonElement;
  readonly randomGameButton: HTMLButtonElement;
  readonly howToButton: HTMLButtonElement;
  readonly statusFace: HTMLElement;
  readonly statusMetric: HTMLElement;
  readonly statusDetail: HTMLElement;
  readonly minesMetric: HTMLElement;
  readonly flagsMetric: HTMLElement;
  readonly timeMetric: HTMLElement;
  readonly progressMetric: HTMLElement;
  readonly progressBar: HTMLProgressElement;
  readonly openedMetric: HTMLElement;
  readonly resetCameraButton: HTMLButtonElement;
  readonly copyLinkButton: HTMLButtonElement;
  readonly voxelCanvas: HTMLCanvasElement;
  readonly webglFallback: HTMLElement;
  readonly cellTooltip: HTMLElement;
  readonly autoplayToggleButton: HTMLButtonElement;
  readonly autoplayStopButton: HTMLButtonElement;
  readonly autoplaySpeedSelect: HTMLSelectElement;
  readonly autoplayStatus: HTMLElement;
  readonly autoplayReason: HTMLElement;
  readonly gameLog: HTMLOListElement;
  readonly howToDialog: HTMLDialogElement;
  readonly closeHowToButton: HTMLButtonElement;
  readonly resultDialog: HTMLDialogElement;
  readonly victoryCelebrationCanvas: HTMLCanvasElement;
  readonly resultKicker: HTMLElement;
  readonly resultTitle: HTMLElement;
  readonly resultText: HTMLElement;
  readonly resultStats: HTMLElement;
  readonly closeResultButton: HTMLButtonElement;
  readonly resultNewGameButton: HTMLButtonElement;
  readonly modeButtons: readonly HTMLButtonElement[];
}

export function collectAppElements(): AppElements {
  return {
    seedInput: requireElement('seedInput', HTMLInputElement),
    difficultySelect: requireElement('difficultySelect', HTMLSelectElement),
    newGameButton: requireElement('newGameButton', HTMLButtonElement),
    randomGameButton: requireElement('randomGameButton', HTMLButtonElement),
    howToButton: requireElement('howToButton', HTMLButtonElement),
    statusFace: requireElement('statusFace', HTMLElement),
    statusMetric: requireElement('statusMetric', HTMLElement),
    statusDetail: requireElement('statusDetail', HTMLElement),
    minesMetric: requireElement('minesMetric', HTMLElement),
    flagsMetric: requireElement('flagsMetric', HTMLElement),
    timeMetric: requireElement('timeMetric', HTMLElement),
    progressMetric: requireElement('progressMetric', HTMLElement),
    progressBar: requireElement('progressBar', HTMLProgressElement),
    openedMetric: requireElement('openedMetric', HTMLElement),
    resetCameraButton: requireElement('resetCameraButton', HTMLButtonElement),
    copyLinkButton: requireElement('copyLinkButton', HTMLButtonElement),
    voxelCanvas: requireElement('voxelCanvas', HTMLCanvasElement),
    webglFallback: requireElement('webglFallback', HTMLElement),
    cellTooltip: requireElement('cellTooltip', HTMLElement),
    autoplayToggleButton: requireElement('autoplayToggleButton', HTMLButtonElement),
    autoplayStopButton: requireElement('autoplayStopButton', HTMLButtonElement),
    autoplaySpeedSelect: requireElement('autoplaySpeedSelect', HTMLSelectElement),
    autoplayStatus: requireElement('autoplayStatus', HTMLElement),
    autoplayReason: requireElement('autoplayReason', HTMLElement),
    gameLog: requireElement('gameLog', HTMLOListElement),
    howToDialog: requireElement('howToDialog', HTMLDialogElement),
    closeHowToButton: requireElement('closeHowToButton', HTMLButtonElement),
    resultDialog: requireElement('resultDialog', HTMLDialogElement),
    victoryCelebrationCanvas: requireElement('victoryCelebrationCanvas', HTMLCanvasElement),
    resultKicker: requireElement('resultKicker', HTMLElement),
    resultTitle: requireElement('resultTitle', HTMLElement),
    resultText: requireElement('resultText', HTMLElement),
    resultStats: requireElement('resultStats', HTMLElement),
    closeResultButton: requireElement('closeResultButton', HTMLButtonElement),
    resultNewGameButton: requireElement('resultNewGameButton', HTMLButtonElement),
    modeButtons: requireModeButtons(),
  };
}
