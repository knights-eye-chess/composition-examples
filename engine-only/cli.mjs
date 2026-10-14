#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Chess } from 'chess.js';
import { createProcessEngine } from '@knights-eye-chess/uci-client/node';

const { values } = parseArgs({ options: {
  fen: { type: 'string', default: new Chess().fen() },
  depth: { type: 'string', default: '8' },
  engine: { type: 'string', default: 'stockfish' },
  'engine-arg': { type: 'string', multiple: true, default: [] },
  help: { type: 'boolean', default: false },
} });
if (values.help) {
  console.log('Usage: node engine-only/cli.mjs [--fen FEN] [--depth N] [--engine PATH] [--engine-arg ARG]');
} else {
  const depth = Number(values.depth);
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 128) throw Error('Depth must be 1..128.');
  new Chess(values.fen);
  const client = createProcessEngine({ command: values.engine, args: values['engine-arg'] });
  try {
    const result = await client.search({ fen: values.fen, limit: { depth }, multiPv: 1 });
    console.log(JSON.stringify(result, null, 2));
  } finally { await client.close(); }
}
