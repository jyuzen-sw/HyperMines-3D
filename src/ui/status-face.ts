import type { AutoplayRunState } from '../autoplay';
import type { ActionMode, GameEvent, GameStatus } from '../game';

export const STATUS_FACE_ANIMATION_INTERVAL = 400;
export const STATUS_FACE_REACTION_DURATION = 800;
export const STATUS_FAILURE_FACES = ['🫣', '🫢', '😩', '😣', '😫'] as const;

export type StatusFaceReaction =
  'reveal' | 'cascade' | 'flagged' | 'unflagged' | 'chorded' | 'rejected';

export type StatusFaceAutoplayActivity = 'analyzing' | 'reveal' | 'flag' | 'chord';
export type StatusFaceAutoplayOutcome =
  'needs-human' | 'contradiction' | 'invalid-observation' | 'error';
export type StatusFailureFace = (typeof STATUS_FAILURE_FACES)[number];

export interface StatusFaceContext {
  readonly gameStatus: GameStatus;
  readonly progress: number;
  readonly remainingMines: number;
  readonly actionMode: ActionMode;
  readonly autoplayStatus: AutoplayRunState;
  readonly autoplayActivity: StatusFaceAutoplayActivity;
  readonly autoplayOutcome: StatusFaceAutoplayOutcome | null;
  readonly failureFace: StatusFailureFace | null;
  readonly reaction: StatusFaceReaction | null;
  readonly animationFrame: number;
  readonly reducedMotion: boolean;
}

const autoplayWorkingFaces = ['🤓', '🧐', '😤', '😠'] as const;

const reactionFaces: Readonly<Record<StatusFaceReaction, string>> = {
  reveal: '😮',
  cascade: '😁',
  flagged: '😉',
  unflagged: '😌',
  chorded: '😲',
  rejected: '😅',
};

export function selectStatusFailureFace(random: () => number = Math.random): StatusFailureFace {
  const index = Math.min(
    STATUS_FAILURE_FACES.length - 1,
    Math.max(0, Math.floor(random() * STATUS_FAILURE_FACES.length)),
  );
  return STATUS_FAILURE_FACES[index]!;
}

export function selectStatusFace(context: StatusFaceContext): string {
  if (context.gameStatus === 'won') return '😎';
  if (context.gameStatus === 'lost') return context.failureFace ?? '😵';

  if (context.autoplayStatus === 'running') {
    switch (context.autoplayActivity) {
      case 'reveal':
        return '🫡';
      case 'flag':
        return '🤨';
      case 'chord':
        return '😲';
      case 'analyzing': {
        if (context.reducedMotion) return autoplayWorkingFaces[0];
        const index =
          ((context.animationFrame % autoplayWorkingFaces.length) + autoplayWorkingFaces.length) %
          autoplayWorkingFaces.length;
        return autoplayWorkingFaces[index]!;
      }
    }
  }

  if (context.autoplayStatus === 'paused') return '😴';
  if (context.reaction !== null) return reactionFaces[context.reaction];

  switch (context.autoplayOutcome) {
    case 'needs-human':
      return '🙃';
    case 'contradiction':
    case 'invalid-observation':
    case 'error':
      return context.failureFace ?? '😖';
    case null:
      break;
  }

  if (context.remainingMines === 0) return '😌';
  if (context.actionMode === 'flag') return '🧐';
  if (context.gameStatus === 'ready') return '😑';
  if (context.progress >= 0.9) return '🤩';
  if (context.progress >= 0.75) return '😃';
  if (context.progress >= 0.5) return '😤';
  if (context.progress >= 0.25) return '🤔';
  return '🙂';
}

export function statusFaceReactionFor(event: GameEvent): StatusFaceReaction | null {
  switch (event.type) {
    case 'revealed':
      return event.revealed > 1 ? 'cascade' : 'reveal';
    case 'flagged':
      return 'flagged';
    case 'unflagged':
      return 'unflagged';
    case 'chorded':
      return 'chorded';
    case 'rejected':
      return 'rejected';
    case 'detonated':
      return null;
  }
}
