// Tree sets: every generated world with forest grows a tree set that fits the place, and the
// Mediterranean worlds grow no Alpine trees.
import { describe, expect, it } from 'vitest';
import { PROP_MODELS } from '../world/propAssets';
import { ROUTES } from './definitions';
import { FLORA } from './flora';

const TREES: readonly string[] = PROP_MODELS.trees;
const ALPINE_ONLY = ['spruce_a', 'spruce_b', 'larch'];
const MEDITERRANEAN = ['riviera', 'cypress', 'calobra', 'mistral', 'levante', 'tuscany', 'sicily', 'catalonia', 'andalucia', 'corsica', 'sierra'];

describe('tree sets (flora.ts)', () => {
  it.each(Object.entries(FLORA))('%s names only Blender tree models', (_name, set) => {
    for (const name of [...set.conifers, ...set.broadleaves]) expect(TREES, name).toContain(name);
    expect(set.conifers.length).toBeGreaterThan(0);
    expect(set.broadleaves.length).toBeGreaterThan(0);
  });

  // Desert has its own code-built props; moor and spruce worlds keep their biome's set on purpose.
  const forested = ROUTES.filter((r) => !['desert', 'moor', 'spruce'].includes(r.scenery.biome ?? 'alpine'));
  it.each(forested.map((r) => [r.id, r] as const))('%s has a tree set', (_id, r) => {
    expect(r.scenery.trees, 'scenery.trees from flora.ts').toBeDefined();
  });

  it('Mediterranean worlds grow pines and holm oak, no spruce or larch', () => {
    for (const id of MEDITERRANEAN) {
      const r = ROUTES.find((x) => x.id === id);
      expect(r, id).toBeDefined();
      const names = [...(r!.scenery.trees?.conifers ?? []), ...(r!.scenery.trees?.broadleaves ?? [])];
      expect(names, id).toContain('holm_oak');
      for (const n of ALPINE_ONLY) expect(names, id).not.toContain(n);
    }
  });
});
