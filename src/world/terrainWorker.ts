/// <reference lib="webworker" />
import { ChunkBuilder, type ChunkRequest } from './terrainChunk';
import { TerrainField, type FieldInput } from './terrainField';

type InMsg = { type: 'init'; input: FieldInput } | { type: 'chunk'; req: ChunkRequest };

let builder: ChunkBuilder | null = null;
const pending: ChunkRequest[] = [];

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const field = new TerrainField(msg.input);
    builder = new ChunkBuilder(field, msg.input.seed);
    ctx.postMessage({ type: 'ready' });
    while (pending.length) run(pending.shift()!);
  } else if (msg.type === 'chunk') {
    if (!builder) pending.push(msg.req);
    else run(msg.req);
  }
};

function run(req: ChunkRequest) {
  const res = builder!.build(req);
  ctx.postMessage({ type: 'chunk', res }, [
    res.positions.buffer,
    res.normals.buffer,
    res.colors.buffer,
    res.props.buffer,
  ]);
}
