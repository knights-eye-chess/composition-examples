#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createClassifierEngine } from '../scripts/classifier-engine.mjs';
import { createComparisonRunner, renderComparisonPgn } from './src/compare.mjs';

const { values } = parseArgs({ options: {
  input: { type: 'string' }, depth: { type: 'string', default: '8' },
  engine: { type: 'string', default: 'stockfish' },
  'engine-arg': { type: 'string', multiple: true, default: [] },
  format: { type: 'string', default: 'pgn' }, help: { type: 'boolean', default: false },
} });
if (values.help) console.log('Usage: node wintrchess-comparison/cli.mjs --input game.pgn [--depth N] [--engine PATH] [--format pgn|json]');
else {
  if (!values.input) throw Error('--input is required.');
  const depth = Number(values.depth);
  if (!['pgn', 'json'].includes(values.format)) throw Error('Format must be pgn or json.');
  const engine = createClassifierEngine({ command: values.engine, args: values['engine-arg'] });
  try {
    const result = await createComparisonRunner(engine, { depth }).run(await readFile(values.input, 'utf8'));
    console.log(values.format === 'pgn' ? renderComparisonPgn(result).trimEnd() : JSON.stringify(result, null, 2));
    if (result.rows.some(row => row.decisions.some(decision => decision.status !== 'complete'))) process.exitCode = 2;
  } finally { await engine.close(); }
}
