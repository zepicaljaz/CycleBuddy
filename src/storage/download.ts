import type { RideSummary } from './types';

/** Small file helpers kept apart from fit.ts, so they do not pull in @garmin/fitsdk. */

export function downloadBytes(bytes: Uint8Array | string, filename: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function rideFileName(s: RideSummary): string {
  const d = new Date(s.startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `CycleBuddy_${stamp}_${s.routeId}.fit`;
}
