import type { Color, Notice } from '@madn/shared';

export const colorLabel = (color: Color): string =>
  `${color.charAt(0).toUpperCase()}${color.slice(1)}`;

/** Names and codes come from people, so they never go into innerHTML raw. */
export const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });

/** What a refusal means in words a player can act on. */
export function noticeText(notice: Notice | null): string {
  if (!notice) return '';

  switch (notice.code) {
    case 'unknownCode':
      return `No game called ${notice.detail ?? 'that'} — check the code.`;
    case 'colorTaken':
      return 'That color is already taken.';
    case 'tooFewPlayers':
      return 'You need at least two players to start.';
    case 'notHost':
      return 'Only the host can do that.';
    case 'notYourTurn':
      return 'Not your turn yet.';
    case 'alreadyRolled':
      return 'You already rolled — choose a piece.';
    case 'illegalMove':
      return 'That piece cannot go there.';
    case 'paused':
      return 'Waiting for a player to come back.';
    case 'notAPlayer':
      return notice.detail === 'already out'
        ? 'That player is already out.'
        : 'You are watching, not playing.';
    case 'notStarted':
      return 'The game has not started yet.';
    case 'finished':
      return 'This game is over.';
    case 'roomClosed':
      return 'This game is closed.';
    default:
      return 'That does not work right now.';
  }
}
