import { describe, expect, it } from 'vitest';
import {
  selectStatusFace,
  selectStatusFailureFace,
  STATUS_FAILURE_FACES,
  type StatusFaceContext,
  type StatusFaceReaction,
} from '../src/ui/status-face';

const defaultContext: StatusFaceContext = {
  gameStatus: 'playing',
  progress: 0,
  remainingMines: 10,
  actionMode: 'open',
  autoplayStatus: 'stopped',
  autoplayActivity: 'analyzing',
  autoplayOutcome: null,
  failureFace: null,
  reaction: null,
  animationFrame: 0,
  reducedMotion: false,
};

function faceFor(overrides: Partial<StatusFaceContext> = {}): string {
  return selectStatusFace({ ...defaultContext, ...overrides });
}

describe('ゲーム状況に応じた顔表示', () => {
  it('準備中と進捗の節目で表情が変わる', () => {
    expect(faceFor({ gameStatus: 'ready' })).toBe('😑');
    expect(faceFor({ progress: 0.24 })).toBe('🙂');
    expect(faceFor({ progress: 0.25 })).toBe('🤔');
    expect(faceFor({ progress: 0.5 })).toBe('😤');
    expect(faceFor({ progress: 0.75 })).toBe('😃');
    expect(faceFor({ progress: 0.9 })).toBe('🤩');
  });

  it('旗モードと残り地雷なしを進捗より優先する', () => {
    expect(faceFor({ actionMode: 'flag', progress: 0.9 })).toBe('🧐');
    expect(faceFor({ actionMode: 'flag', remainingMines: 0 })).toBe('😌');
  });

  it.each<[StatusFaceReaction, string]>([
    ['reveal', '😮'],
    ['cascade', '😁'],
    ['flagged', '😉'],
    ['unflagged', '😌'],
    ['chorded', '😲'],
    ['rejected', '😅'],
  ])('%s操作へ%sで反応する', (reaction, face) => {
    expect(faceFor({ reaction })).toBe(face);
  });

  it('AI解析中は4つの作業表情を巡回する', () => {
    const faces = [0, 1, 2, 3, 4].map((animationFrame) =>
      faceFor({ autoplayStatus: 'running', animationFrame }),
    );
    expect(faces).toEqual(['🤓', '🧐', '😤', '😠', '🤓']);
  });

  it('AIの実行内容と停止状況を表情で区別する', () => {
    expect(faceFor({ autoplayStatus: 'running', autoplayActivity: 'reveal' })).toBe('🫡');
    expect(faceFor({ autoplayStatus: 'running', autoplayActivity: 'flag' })).toBe('🤨');
    expect(faceFor({ autoplayStatus: 'running', autoplayActivity: 'chord' })).toBe('😲');
    expect(faceFor({ autoplayStatus: 'paused' })).toBe('😴');
    expect(faceFor({ autoplayOutcome: 'needs-human' })).toBe('🙃');
    expect(faceFor({ autoplayOutcome: 'contradiction', failureFace: '🫣' })).toBe('🫣');
    expect(faceFor({ autoplayOutcome: 'invalid-observation', failureFace: '😩' })).toBe('😩');
    expect(faceFor({ autoplayOutcome: 'error', failureFace: '😫' })).toBe('😫');
  });

  it.each(STATUS_FAILURE_FACES)('ゲーム失敗時は選択済みの%sを表示する', (failureFace) => {
    expect(faceFor({ gameStatus: 'lost', failureFace })).toBe(failureFace);
  });

  it('期待どおりの人間への引き渡しには失敗表情を使わない', () => {
    expect(faceFor({ autoplayOutcome: 'needs-human', failureFace: '😣' })).toBe('🙃');
  });

  it.each(STATUS_FAILURE_FACES.map((face, index) => [face, index] as const))(
    '失敗時の表情として%sを選択できる',
    (face, index) => {
      const selection = (index + 0.5) / STATUS_FAILURE_FACES.length;
      expect(selectStatusFailureFace(() => selection)).toBe(face);
    },
  );

  it('動きを減らす設定ではAI解析中の表情を固定する', () => {
    expect(faceFor({ autoplayStatus: 'running', animationFrame: 3, reducedMotion: true })).toBe(
      '🤓',
    );
  });

  it('勝敗を他の一時的な状態より優先する', () => {
    const busy = {
      autoplayStatus: 'running',
      autoplayActivity: 'flag',
      reaction: 'rejected',
    } as const;
    expect(faceFor({ ...busy, gameStatus: 'won' })).toBe('😎');
    expect(faceFor({ ...busy, gameStatus: 'lost' })).toBe('😵');
  });
});
