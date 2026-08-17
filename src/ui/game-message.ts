import {
  formatCoordinate,
  type GameEvent,
  type GameRejectionReason,
  type PublicObservation,
} from '../game';

export type MessageTone = 'info' | 'success' | 'warning' | 'danger';

export interface GameMessage {
  readonly text: string;
  readonly tone: MessageTone;
}

const rejectionMessages: Readonly<Record<GameRejectionReason, string>> = {
  'game-over': 'この盤面は終了しています。新しい盤面を開始してください。',
  'cell-revealed': '開いたマスには旗を置けません。',
  'cell-flagged': '旗を外してからマスを開いてください。',
  'not-surface': 'そのマスはまだ開けません。外側のマスから順に開いてください。',
  'flag-limit': '置ける旗をすべて使っています。不要な旗を外してください。',
  'chord-needs-clue': '周囲を開くには、数字が表示されたマスを選んでください。',
  'chord-count-mismatch': '手掛かりの数と周囲の旗数が一致していません。',
  'chord-no-targets': '周囲に開けるマスがありません。',
};

export function describeGameEvent(event: GameEvent, observation: PublicObservation): GameMessage {
  const coordinate =
    'targetId' in event ? formatCoordinate(observation.cells[event.targetId]!.coordinate) : '';
  switch (event.type) {
    case 'revealed':
      return {
        text: `${coordinate} を開きました${event.revealed > 1 ? `（${event.revealed}マス連続）` : ''}。`,
        tone: event.status === 'won' ? 'success' : 'info',
      };
    case 'flagged':
      return { text: `${coordinate} に旗を置き、奥のマスを操作可能にしました。`, tone: 'warning' };
    case 'unflagged':
      return { text: `${coordinate} の旗を外しました。`, tone: 'info' };
    case 'chorded':
      return {
        text: `${coordinate} の周囲を開きました（${event.revealed}マス）。`,
        tone: event.status === 'won' ? 'success' : 'success',
      };
    case 'detonated':
      return { text: `${coordinate} の地雷が爆発しました。`, tone: 'danger' };
    case 'rejected':
      return { text: rejectionMessages[event.reason], tone: 'warning' };
  }
}
