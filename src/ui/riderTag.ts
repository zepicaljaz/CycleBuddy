/** What kind of ride the label is shown in. */
export type TagMode = 'free' | 'train' | 'hillclimb' | 'career';

export interface TagRider {
  name: string;
  /** Place in the overall before this stage, 0 is the leader. Career stage races only. */
  gcRank?: number;
  /** Seconds behind the overall leader. */
  gcGap?: number;
}

export interface TagLines {
  name?: string;
  /** "4th overall" and "+1:24", or "Leader" with no gap. */
  standing?: { place: string; gap: string };
  wkg: string;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`;
}

/** Overall gap like a results sheet: +0:42, +12:05, +1:02:10. */
export function gapClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `+${h}:${String(m).padStart(2, '0')}:${ss}` : `+${m}:${ss}`;
}

/**
 * The text over a rider you point at. Free ride and training show the effort only.
 * A hill-climb adds the name. A career stage adds the overall place and gap,
 * when the race has an overall yet (a stage race after its first day).
 */
export function tagLines(mode: TagMode, rider: TagRider, wkg: number): TagLines {
  const lines: TagLines = { wkg: `${Math.max(0, wkg).toFixed(1)} W/kg` };
  if (mode === 'free' || mode === 'train') return lines;
  lines.name = rider.name;
  if (mode === 'career' && rider.gcRank != null) {
    lines.standing = rider.gcRank === 0
      ? { place: '1st overall', gap: 'Leader' }
      : { place: `${ordinal(rider.gcRank + 1)} overall`, gap: gapClock(rider.gcGap ?? 0) };
  }
  return lines;
}

/** Floating label over the rider under the cursor. Never takes the pointer. */
export class RiderTag {
  readonly el: HTMLElement;
  private nameEl: HTMLElement;
  private placeEl: HTMLElement;
  private gapEl: HTMLElement;
  private standEl: HTMLElement;
  private wkgEl: HTMLElement;
  private shown = false;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'rider-tag';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = '<b class="rt-name"></b><span class="rt-stand"><span class="rt-place"></span><span class="rt-gap"></span></span><strong class="rt-wkg"></strong>';
    this.nameEl = this.el.querySelector('.rt-name')!;
    this.standEl = this.el.querySelector('.rt-stand')!;
    this.placeEl = this.el.querySelector('.rt-place')!;
    this.gapEl = this.el.querySelector('.rt-gap')!;
    this.wkgEl = this.el.querySelector('.rt-wkg')!;
    this.el.hidden = true;
    host.appendChild(this.el);
  }

  show(lines: TagLines, x: number, y: number): void {
    set(this.nameEl, lines.name ?? '');
    this.nameEl.hidden = !lines.name;
    this.standEl.hidden = !lines.standing;
    set(this.placeEl, lines.standing?.place ?? '');
    set(this.gapEl, lines.standing?.gap ?? '');
    set(this.wkgEl, lines.wkg);
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    if (!this.shown) {
      this.el.hidden = false;
      this.shown = true;
    }
  }

  hide(): void {
    if (!this.shown) return;
    this.el.hidden = true;
    this.shown = false;
  }
}

/** Writing the same text again still costs a layout, so only write changes. */
function set(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
