// Dev-only: model scenes, or a whole world with ?scene=world.
if (new URLSearchParams(location.search).get('scene') === 'world') await import('./previewWorld');
else await import('./preview');

export {};
