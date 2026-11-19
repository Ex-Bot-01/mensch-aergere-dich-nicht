import type { Status } from '../connection.js';

const WORDS: Record<Status, string> = {
  online: '',
  offline: 'Connection lost — trying again. The game carries on without you.',
  closed: 'This game is closed.',
};

/** One line about the wire, so a dropped phone reads as a wait and not a frozen page. */
export function renderStatus(root: HTMLElement, status: Status): void {
  root.textContent = WORDS[status];
  root.hidden = status === 'online';
  root.dataset.status = status;
}
