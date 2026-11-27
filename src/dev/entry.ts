// Dev-only: model scenes, a whole world with ?scene=world, or a fixed camera on a real road with ?scene=road.
const scene = new URLSearchParams(location.search).get('scene');
if (scene === 'world') await import('./previewWorld');
else if (scene === 'road') await import('./previewRoad');
else await import('./preview');

export {};
