import { brandLogo } from '../brand';

/** Logo and moving bar shown while /play downloads and the menu world builds. */
export function showPlayBoot(): void {
  if (document.getElementById('play-boot')) return;
  const el = document.createElement('div');
  el.id = 'play-boot';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Loading');
  el.innerHTML = `${brandLogo()}<div class="load-line" aria-hidden="true"><span></span></div>`;
  document.body.appendChild(el);
}

export function hidePlayBoot(immediate = false): void {
  const el = document.getElementById('play-boot');
  if (!(el instanceof HTMLElement)) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (immediate || reduce || el.classList.contains('leave')) {
    el.remove();
    return;
  }
  el.classList.add('leave');
  window.setTimeout(() => el.remove(), 450);
}
