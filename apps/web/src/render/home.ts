import { esc, noticeText } from '../copy.js';
import type { HomeApi } from './shared.js';

/** The first thing anybody sees: say who you are, then create or join. */
export function renderHome(root: HTMLElement, api: HomeApi): void {
  root.innerHTML = `<section class="screen home">
    <h1>Mensch ärgere dich nicht</h1>
    <p class="tagline">Four colors, one code, no install.</p>
    <label for="name">Your name</label>
    <input id="name" name="name" maxlength="24" autocomplete="off" value="${esc(api.name)}">
    <button type="button" data-act="create">Create a game</button>
    <div class="join">
      <label for="code">Room code</label>
      <input id="code" name="code" maxlength="6" autocapitalize="characters" value="${esc(
        api.code ?? '',
      )}">
      <button type="button" data-act="join">Join</button>
    </div>
    <p class="notice" data-notice>${esc(noticeText(api.notice))}</p>
  </section>`;

  const name = root.querySelector<HTMLInputElement>('input[name="name"]')!;
  const code = root.querySelector<HTMLInputElement>('input[name="code"]')!;
  const who = (): string => name.value.trim() || 'guest';

  root.querySelector('[data-act="create"]')?.addEventListener('click', () => api.create(who()));
  root.querySelector('[data-act="join"]')?.addEventListener('click', () => {
    api.join(code.value.trim().toUpperCase(), who());
  });
}
