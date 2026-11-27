// The per-road scenery hints in climbs.json (rockTone, trees): valid values, sourced, and passed
// through to the route's scenery.
import { describe, expect, it } from 'vitest';
import { PROP_MODELS } from '../../world/propAssets';
import { ensureAllTracks, realClimbRoute } from './build';
import { REAL_CLIMBS } from './data';

await ensureAllTracks();

const TREES: readonly string[] = PROP_MODELS.trees;
const hinted = REAL_CLIMBS.filter((c) => c.rockTone || c.trees);

describe('scenery hints', () => {
  it('are on the roads that were researched', () => {
    const ids = hinted.map((c) => c.id);
    for (const id of ['ventoux-bedoin', 'galibier-valloire', 'tourmalet-luz', 'vrsic-kranjska-gora', 'stelvio-prato', 'alpe-dhuez-bourg-doisans']) expect(ids).toContain(id);
  });

  it.each(hinted.map((c) => [c.id, c] as const))('%s: valid tone and tree models, with a sourced sceneryNote', (_id, c) => {
    if (c.rockTone) expect(['pale', 'grey', 'dark']).toContain(c.rockTone);
    for (const name of [...(c.trees?.conifers ?? []), ...(c.trees?.broadleaves ?? [])]) expect(TREES, name).toContain(name);
    expect(c.sceneryNote, 'hints need their sources').toMatch(/https?:\/\//);
  });

  it.each(hinted.map((c) => [c.id, c] as const))('%s: reaches the route scenery', (_id, c) => {
    const sc = realClimbRoute(c).scenery;
    expect(sc.rockTone).toBe(c.rockTone);
    expect(sc.trees).toEqual(c.trees);
  });
});
