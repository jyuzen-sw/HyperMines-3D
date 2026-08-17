import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoplayController, type AutoDecision, type PublicObservation } from '../../src/autoplay';

function observation(revision = 0): PublicObservation {
  return {
    revision,
    status: 'ready',
    dimensions: { width: 1, height: 1, depth: 1 },
    mineCount: 0,
    remainingMines: 0,
    flagCount: 0,
    cells: [
      {
        id: 0,
        coordinate: { x: 0, y: 0, z: 0 },
        state: 'covered',
        clue: null,
        isSurface: true,
      },
    ],
  };
}

function revealDecision(current: PublicObservation): AutoDecision {
  return {
    kind: 'reveal',
    targetId: 0,
    expectedRevision: current.revision,
    reason: '初手と周囲の安全',
  };
}

describe('AutoplayController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('既定800msごとに1操作ずつ実行する', async () => {
    let revision = 0;
    const execute = vi.fn(() => {
      revision += 1;
      return { accepted: true, changed: true };
    });
    const controller = new AutoplayController({
      observe: () => observation(revision),
      decide: revealDecision,
      executeDecision: execute,
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(799);
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(execute).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('速度変更時に待機時間を張り直す', async () => {
    const execute = vi.fn(() => ({ accepted: true, changed: true }));
    const controller = new AutoplayController({
      observe: () => observation(0),
      decide: revealDecision,
      executeDecision: execute,
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(300);
    controller.setSpeed(2);
    await vi.advanceTimersByTimeAsync(399);
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('推測が必要な判断では理由を残して停止する', async () => {
    const execute = vi.fn(() => ({ accepted: true, changed: true }));
    const controller = new AutoplayController({
      observe: () => observation(0),
      decide: (current) => ({
        kind: 'stop',
        stopReason: 'needs-human',
        expectedRevision: current.revision,
        reason: '確定手がありません。運ゲーは人間の担当です。',
      }),
      executeDecision: execute,
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(800);
    expect(controller.state).toMatchObject({
      status: 'stopped',
      reason: '確定手がありません。運ゲーは人間の担当です。',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('停止後は人間の操作だけで自動再開しない', async () => {
    const execute = vi.fn(() => ({ accepted: true, changed: true }));
    const controller = new AutoplayController({
      observe: () => observation(0),
      decide: revealDecision,
      executeDecision: execute,
    });
    controller.start();
    controller.stop('人間の番');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(execute).not.toHaveBeenCalled();
    expect(controller.state.status).toBe('stopped');
  });
});
