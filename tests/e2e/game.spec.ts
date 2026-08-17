import { expect, test, type Page } from '@playwright/test';
import * as THREE from 'three';

const fieldUrl = './?seed=20240807&level=beginner';
const frontCenter = { x: 2, y: 2, z: 4 } as const;

interface CellCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

async function waitForApplication(page: Page, url = fieldUrl): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('HYPERMINES');
  await expect(page.locator('#statusMetric')).toHaveText('準備中');
  await expect(page.locator('#statusFace')).toHaveText('😑');
  await expect(page.locator('#difficultySelect')).toHaveValue('beginner');
  await expect(page.locator('#voxelCanvas')).toBeVisible();
  await expect(page.locator('#webglFallback')).toBeHidden();
}

async function boardSnapshot(page: Page): Promise<string> {
  return page.locator('body').evaluate(() => {
    const text = (selector: string): string =>
      document.querySelector(selector)?.textContent?.trim() ?? '';
    return JSON.stringify({
      status: text('#statusMetric'),
      mines: text('#minesMetric'),
      flags: text('#flagsMetric'),
      progress: text('#progressMetric'),
      message: text('#gameLog .game-log-entry:first-child'),
    });
  });
}

async function screenPointForCell(page: Page, coordinate: CellCoordinate): Promise<ScreenPoint> {
  const canvas = page.locator('#voxelCanvas');
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error('3D board canvas has no bounding box');
  const boardSize = 5;
  const camera = new THREE.PerspectiveCamera(42, bounds.width / bounds.height, 0.1, 200);
  camera.position.set(boardSize * 1.05, boardSize * 0.86, boardSize * 1.48);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const projected = new THREE.Vector3(
    coordinate.x - (boardSize - 1) / 2,
    coordinate.y - (boardSize - 1) / 2,
    coordinate.z - (boardSize - 1) / 2,
  ).project(camera);
  return {
    x: bounds.x + ((projected.x + 1) * bounds.width) / 2,
    y: bounds.y + ((1 - projected.y) * bounds.height) / 2,
  };
}

async function clickCell(
  page: Page,
  coordinate: CellCoordinate,
  options: { readonly button?: 'left' | 'right' } = {},
): Promise<void> {
  const point = await screenPointForCell(page, coordinate);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#cellTooltip')).toContainText(
    `X${coordinate.x + 1} · Y${coordinate.y + 1} · Z${coordinate.z + 1}`,
  );
  await page.mouse.click(point.x, point.y, { button: options.button ?? 'left' });
}

async function repeatCellClicks(page: Page, point: ScreenPoint, count: number): Promise<void> {
  await page.evaluate(
    async ({ x, y, count: clickCount }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#voxelCanvas');
      if (canvas === null) throw new Error('3D board canvas is missing');
      for (let index = 0; index < clickCount; index += 1) {
        canvas.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }),
        );
        canvas.dispatchEvent(
          new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: x, clientY: y }),
        );
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    },
    { ...point, count },
  );
}

async function expectResponsiveLayout(page: Page): Promise<number> {
  const layout = await page.locator('body').evaluate(() => {
    const rectangle = (selector: string): DOMRect => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) throw new Error(`Missing layout element: ${selector}`);
      return element.getBoundingClientRect();
    };
    const statusItems = [
      rectangle('.mines-counter'),
      rectangle('.assistant-header-status'),
      rectangle('.time-counter'),
    ];
    const face = rectangle('.face-button');
    const bubble = rectangle('.autoplay-speech-bubble');
    const toolbar = rectangle('.board-toolbar');
    const board = rectangle('.board-panel');
    const canvas = rectangle('#voxelCanvas');
    const toolButtons = Array.from(
      document.querySelectorAll<HTMLElement>('.header-icon-button'),
      (button) => button.getBoundingClientRect(),
    );
    const divider = rectangle('.header-tools-divider');
    return {
      bodyOverflowsHorizontally: document.documentElement.scrollWidth > window.innerWidth,
      bodyOverflowsVertically: document.documentElement.scrollHeight > window.innerHeight,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      toolbarOverflows:
        document.querySelector<HTMLElement>('.board-toolbar')!.scrollWidth >
        document.querySelector<HTMLElement>('.board-toolbar')!.clientWidth,
      isStacked: window.innerWidth <= 700,
      isWide: window.innerWidth >= 1121,
      viewportHeight: window.innerHeight,
      statusItems: statusItems.map(({ x, y, width, height }) => ({ x, y, width, height })),
      face: { x: face.x, y: face.y, width: face.width, height: face.height },
      bubble: { x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height },
      toolbar: { x: toolbar.x, width: toolbar.width },
      board: { y: board.y, height: board.height },
      canvasHeight: canvas.height,
      toolButtons: toolButtons.map(({ x, width, height }) => ({ x, width, height })),
      divider: {
        x: divider.x,
        width: divider.width,
        height: divider.height,
      },
    };
  });
  expect(layout.bodyOverflowsHorizontally).toBe(false);
  expect(layout.toolbarOverflows).toBe(false);
  expect(layout.canvasHeight).toBeGreaterThan(0);
  if (layout.isWide) {
    expect(layout.bodyOverflowsVertically).toBe(false);
    expect(layout.board.y + layout.board.height).toBeLessThanOrEqual(layout.viewportHeight + 1);
  } else {
    expect(layout.bodyOverflowY).not.toBe('hidden');
  }
  expect(layout.statusItems).toHaveLength(3);
  expect(layout.toolButtons).toHaveLength(4);
  const [mines, assistant, time] = layout.statusItems;
  expect(Math.abs(mines!.width - time!.width)).toBeLessThanOrEqual(1);
  expect(mines!.width).toBeLessThanOrEqual(200);
  expect(layout.face.x).toBeLessThan(layout.bubble.x);
  expect(layout.face.y).toBe(layout.bubble.y);
  expect(Math.abs(layout.face.height - layout.bubble.height)).toBeLessThanOrEqual(1);
  if (layout.isStacked) {
    expect(Math.abs(mines!.y - time!.y)).toBeLessThanOrEqual(1);
    expect(assistant!.y).toBeGreaterThanOrEqual(mines!.y + mines!.height + 6);
    expect(Math.abs(assistant!.x - mines!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(assistant!.x + assistant!.width - (time!.x + time!.width))).toBeLessThanOrEqual(
      1,
    );
  } else {
    expect(mines!.x).toBeLessThan(assistant!.x);
    expect(assistant!.x).toBeLessThan(time!.x);
    expect(assistant!.width).toBeGreaterThan(mines!.width);
    expect(Math.abs(mines!.y - assistant!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(mines!.y - time!.y)).toBeLessThanOrEqual(1);
  }
  expect(assistant!.x).toBeGreaterThanOrEqual(layout.toolbar.x);
  expect(assistant!.x + assistant!.width).toBeLessThanOrEqual(
    layout.toolbar.x + layout.toolbar.width,
  );
  for (const button of layout.toolButtons.slice(1)) {
    expect(Math.abs(layout.toolButtons[0]!.width - button.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.toolButtons[0]!.height - button.height)).toBeLessThanOrEqual(1);
  }
  const flagButton = layout.toolButtons[1]!;
  const resetCameraButton = layout.toolButtons[2]!;
  expect(flagButton.x + flagButton.width).toBeLessThan(layout.divider.x);
  expect(layout.divider.x + layout.divider.width).toBeLessThan(resetCameraButton.x);
  expect(layout.divider.height).toBeGreaterThan(0);
  return layout.bubble.width;
}

test.describe('HyperMines 3Dのゲーム体験', () => {
  test('操作を区分し、顔の横のAI吹き出しを画面幅に合わせて表示する', async ({ page }) => {
    await waitForApplication(page);
    const tools = page.locator('.header-tools').getByRole('button');
    await expect(tools).toHaveCount(4);
    await expect(tools.nth(0)).toHaveAccessibleName('開くモード');
    await expect(tools.nth(1)).toHaveAccessibleName('旗モード');
    await expect(tools.nth(2)).toHaveAccessibleName('視点を戻す');
    await expect(tools.nth(3)).toHaveAccessibleName('共有URLをコピー');
    await expect(tools.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('separator')).toHaveCount(1);
    await expect(page.locator('#randomGameButton')).toHaveText('新しいゲーム');
    await expect(page.locator('.board-toolbar').locator(':scope > *')).toHaveCount(3);
    await expect(page.locator('.assistant-header-status #autoplayReason')).toHaveCount(1);
    await expect(page.locator('.autoplay-panel #autoplayReason')).toHaveCount(0);
    await expect(page.locator('#autoplayReason')).toHaveAttribute('role', 'status');
    await expect(page.locator('#autoplayReason')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('.selected-panel')).toHaveCount(0);
    await expect(
      page.locator(
        '#selectedCoordinate, #selectedState, #selectedClue, #selectedSurface, #selectedRevealButton, #selectedFlagButton, #selectedChordButton',
      ),
    ).toHaveCount(0);
    expect(
      await page
        .locator('#progressBar')
        .evaluate((element) => (element as HTMLProgressElement).value),
    ).toBe(0);
    await expect(page.locator('#openedMetric')).toHaveText('0 / 115 マス');
    await expect(page.locator('.control-column .panel-header h2')).toHaveText([
      '進捗',
      'AIアシスト',
      'ゲームログ',
    ]);

    const bubbleWidths: number[] = [];
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 820, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      bubbleWidths.push(await expectResponsiveLayout(page));
    }
    expect(bubbleWidths[0]).toBeGreaterThan(bubbleWidths[1]!);
    expect(bubbleWidths[1]).toBeGreaterThan(bubbleWidths[2]!);
    await page.setViewportSize({ width: 1280, height: 600 });
    await expectResponsiveLayout(page);
  });

  test('Canvas上で開くモードと旗モードを直接操作できる', async ({ page }) => {
    await waitForApplication(page);
    await page.getByRole('button', { name: '旗モード' }).click();
    await expect(page.getByRole('button', { name: '旗モード' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await clickCell(page, frontCenter);
    await expect(page.locator('#flagsMetric')).toHaveText('旗 1 / 10');
    await expect(page.locator('#statusFace')).toHaveText('😉');
    await page.getByRole('button', { name: '開くモード' }).click();
    await clickCell(page, frontCenter, { button: 'right' });
    await expect(page.locator('#flagsMetric')).toHaveText('旗 0 / 10');
    await expect(page.locator('#statusFace')).toHaveText('😌');

    await page.keyboard.press('2');
    await expect(page.getByRole('button', { name: '旗モード' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('1');
    await clickCell(page, frontCenter);
    await expect(page.locator('#statusMetric')).toHaveText('プレイ中');
    await expect(page.locator('#statusFace')).toHaveText('😁');
    await expect(page).toHaveURL(/start=3-3-5/);
    await expect
      .poll(async () => Number((await page.locator('#openedMetric').textContent())?.split('/')[0]))
      .toBeGreaterThanOrEqual(18);
    expect(
      await page
        .locator('#progressBar')
        .evaluate((element) => (element as HTMLProgressElement).value),
    ).toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    await expect(page.locator('#statusFace')).toHaveText(/🙂|🤔|😤|😃|🤩/);
  });

  test('右ドラッグで旗を置かずに盤面をパンし、視点を元へ戻せる', async ({ page }) => {
    await waitForApplication(page);
    const point = await screenPointForCell(page, frontCenter);
    const tooltip = page.locator('#cellTooltip');
    const coordinateText = 'X3 · Y3 · Z5';
    await page.mouse.move(point.x, point.y);
    await expect(tooltip).toContainText(coordinateText);
    const flagsBefore = await page.locator('#flagsMetric').textContent();

    await page.mouse.down({ button: 'right' });
    await page.mouse.move(point.x + 160, point.y, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    await expect(page.locator('#flagsMetric')).toHaveText(flagsBefore!);
    await page.mouse.move(point.x + 2, point.y + 2);
    await page.mouse.move(point.x, point.y);
    expect(
      await tooltip.evaluate(
        (element, originalCoordinate) =>
          (element instanceof HTMLElement && element.hidden) ||
          !element.textContent?.includes(originalCoordinate),
        coordinateText,
      ),
    ).toBe(true);

    await page.locator('#resetCameraButton').click();
    const resetPoint = await screenPointForCell(page, frontCenter);
    await page.mouse.move(resetPoint.x + 2, resetPoint.y + 2);
    await page.mouse.move(resetPoint.x, resetPoint.y);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(coordinateText);
  });

  test('遊び方を開いても盤面を変更しない', async ({ page }) => {
    await waitForApplication(page);
    await clickCell(page, frontCenter);
    const before = await boardSnapshot(page);

    await page.locator('#howToButton').click();
    const dialog = page.getByRole('dialog', { name: '遊び方' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('最大26マス');
    await expect(dialog).toContainText('運試しの一手');
    await expect(dialog).toContainText('👆 / 🚩');
    await expect(dialog).toContainText('右ドラッグ');
    await expect(dialog).not.toContainText('PageUp');
    await page.locator('#closeHowToButton').click();
    await expect(dialog).toBeHidden();
    expect(await boardSnapshot(page)).toBe(before);
  });

  test('ゲームログは新しい順に100件を保持し、追従と新規ゲーム時の初期化を行う', async ({
    page,
  }) => {
    test.slow();
    await waitForApplication(page);
    await page.getByRole('button', { name: '旗モード' }).click();
    const point = await screenPointForCell(page, frontCenter);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('#cellTooltip')).toContainText('X3 · Y3 · Z5');
    await repeatCellClicks(page, point, 102);

    const log = page.locator('#gameLog');
    await expect(log).toHaveAttribute('role', 'log');
    await expect(log.locator('.game-log-entry')).toHaveCount(100);
    const scrolling = await log.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }));
    expect(scrolling.scrollHeight).toBeGreaterThan(scrolling.clientHeight);
    expect(scrolling.clientHeight).toBeLessThanOrEqual(240);
    expect(scrolling.scrollTop).toBeLessThanOrEqual(1);

    const previousLatest = await log.locator('.game-log-entry').first().textContent();
    await repeatCellClicks(page, point, 1);
    await expect(log.locator('.game-log-entry').nth(1)).toHaveText(previousLatest!);

    const oldLogPosition = await log.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    expect(oldLogPosition).toBeGreaterThan(1);
    await repeatCellClicks(page, point, 2);
    expect(await log.evaluate((element) => element.scrollTop)).toBeGreaterThan(1);

    await page.locator('#newGameButton').click();
    await expect(log.locator('.game-log-entry')).toHaveCount(1);
    await expect(log).toContainText('新しい盤面を生成しました');
  });

  test('AIは確定手がなくなると人間へ運ゲーを引き渡し、自動再開しない', async ({ page }) => {
    await waitForApplication(page, './?seed=1&level=beginner');
    await page.locator('#autoplaySpeedSelect').selectOption('2');
    await page.locator('#autoplayToggleButton').click();
    await expect(page.locator('#autoplayStatus')).toHaveText('実行中');
    await expect(page.locator('#statusFace')).toHaveText(/🤓|🧐|😤|😠|🫡|🤨|😲/);
    await expect(page.locator('#autoplayStatus')).toHaveText('停止中', { timeout: 15_000 });
    await expect(page.locator('#autoplayReason')).toContainText('運ゲー');
    await expect(page.locator('#statusFace')).toHaveText('🙃');
    await expect(
      page.locator('.game-log-entry', { hasText: 'AIアシストが確定手を解析しています。' }),
    ).toHaveCount(0);

    const stopped = await boardSnapshot(page);
    await page.waitForTimeout(1_200);
    expect(await boardSnapshot(page)).toBe(stopped);

    await page.locator('#autoplayToggleButton').click();
    await expect(page.locator('#autoplayStatus')).toHaveText('停止中');
    await expect(page.locator('#autoplayReason')).toContainText('運ゲー');
  });

  test('解析中コメントは通常の手待ち中だけ吹き出しへ表示する', async ({ page }) => {
    await waitForApplication(page, './?seed=1&level=beginner');
    await page.locator('#autoplaySpeedSelect').selectOption('0.5');
    await page.locator('#autoplayToggleButton').click();

    const comment = page.locator('#autoplayReason');
    await expect(comment).toHaveText('AIアシストが確定手を解析しています。');
    await expect(
      page.locator('.game-log-entry', { hasText: 'AIアシストが確定手を解析しています。' }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () => Number((await page.locator('#progressMetric').textContent())?.replace('%', '')),
        { timeout: 4_000 },
      )
      .toBeGreaterThan(0);
    await expect(comment).toHaveText('AIアシストが確定手を解析しています。');
    await expect(
      page.locator('.game-log-entry', { hasText: 'AIアシストが確定手を解析しています。' }),
    ).toHaveCount(0);
  });

  test('クリアすると左右クラッカーの無音演出を表示し、閉じると停止する', async ({ page }) => {
    await waitForApplication(page, './?seed=5&level=beginner');
    await page.locator('#autoplaySpeedSelect').selectOption('2');
    await page.locator('#autoplayToggleButton').click();

    const resultDialog = page.getByRole('dialog', { name: 'congratulations!' });
    const celebration = page.locator('#victoryCelebrationCanvas');
    await expect(resultDialog).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#statusMetric')).toHaveText('クリア');
    await expect(page.locator('#statusFace')).toHaveText('😎');
    await expect(page.locator('#resultText')).toHaveText('全てのマスを開きました！');
    await expect(celebration).toHaveAttribute('data-celebration', 'running');
    await page.locator('#closeResultButton').click();
    await expect(resultDialog).toBeHidden();
    await expect(celebration).toHaveAttribute('data-celebration', 'idle');

    await page.locator('#newGameButton').click();
    await expect(page.locator('#statusMetric')).toHaveText('準備中');
    await expect(page.locator('#statusFace')).toHaveText('😑');
    await expect(page.locator('.game-log-entry')).toHaveCount(1);
  });

  test('地雷をCanvas上で開いたときは勝利演出を開始しない', async ({ page }) => {
    await waitForApplication(page);
    await clickCell(page, frontCenter);
    await clickCell(page, { x: 4, y: 4, z: 4 });

    await expect(page.getByRole('dialog', { name: 'GAME OVER' })).toBeVisible();
    await expect(page.locator('#statusFace')).toHaveText(/^(🫣|🫢|😩|😣|😫)$/);
    await expect(page.locator('#victoryCelebrationCanvas')).toHaveAttribute(
      'data-celebration',
      'idle',
    );
  });

  test('動きを減らす設定では静止した勝利演出を表示する', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await waitForApplication(page, './?seed=5&level=beginner');
    await page.locator('#autoplaySpeedSelect').selectOption('2');
    await page.locator('#autoplayToggleButton').click();

    await expect(page.locator('#statusFace')).toHaveText('🤓');

    await expect(page.getByRole('dialog', { name: 'congratulations!' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('#victoryCelebrationCanvas')).toHaveAttribute(
      'data-celebration',
      'static',
    );
  });
});
