import { App } from './app';
import { hidePlayBoot } from './playBoot';
import { currentUser } from '../site/auth';
import { IndexedDbStorage } from '../storage/indexedDb';
import { claimLocalData } from '../storage/localOwner';

export async function startGame(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const root = document.getElementById('app') as HTMLElement;
  const plan = new URLSearchParams(location.search).get('plan');
  if (plan) sessionStorage.setItem('cb-plan', plan);
  try {
    const user = await currentUser();
    if (!user) {
      location.replace('/?auth=signin');
      return;
    }
    // Rides, rider and career on this computer belong to one account. Another
    // account's data is cleared before the app can show it or upload it here.
    try {
      await claimLocalData(user.id, new IndexedDbStorage());
    } catch (err) {
      console.error('Could not check whose data is on this computer', err);
    }
  } catch (err) {
    hidePlayBoot(true);
    root.innerHTML = `<div class="fatal"><h2>Sign-in is unavailable</h2><p>${escapeHtml(err instanceof Error ? err.message : 'The account server is not running.')}</p><p><a href="/">Back to the homepage</a></p></div>`;
    return;
  }

  const app = new App(canvas, root);
  if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
  app.start().catch((err) => {
    console.error(err);
    hidePlayBoot(true);
    root.innerHTML = `<div class="fatal"><h2>CycleBuddy could not start</h2><p>${escapeHtml(String(err?.message ?? err))}</p><p>Please use an up-to-date Google Chrome or Microsoft Edge with hardware acceleration enabled.</p></div>`;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
