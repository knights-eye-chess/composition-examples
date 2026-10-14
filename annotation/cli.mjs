#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { annotatePgn, renderAnnotatedPgn, renderJsonl } from './annotate.mjs';
import { createClassifierEngine } from '../scripts/classifier-engine.mjs';

const HELP = `Usage: knights-eye-annotate [--input game.pgn] [--output annotated.pgn]
  --format pgn|jsonl       Default: pgn
  --depth INTEGER         Default: 12 (1..128)
  --engine PATH           Default: stockfish
  --engine-arg ARG         Repeat for engine arguments (including Node UCI assets)
  --timeout-ms INTEGER    Search timeout, default: 65000
  --records               Include display-only classifier-decision/1 records in JSONL
  --help                  Show help
Input defaults to stdin; output defaults to stdout. One game, main line only.
Unavailable occurrences are explicit; SIGINT/SIGTERM cancels analysis and drains
the child before emitting the complete/unavailable occurrence output (exit 130/143).
`;

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, output: { type: 'string' }, format: { type: 'string', default: 'pgn' },
    depth: { type: 'string', default: '12' }, engine: { type: 'string', default: 'stockfish' },
    'engine-arg': { type: 'string', multiple: true, default: [] },
    'timeout-ms': { type: 'string', default: '65000' }, records: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  }, allowPositionals: false, strict: true });
  if (values.help) { process.stdout.write(HELP); return; }
  const depth = Number(values.depth), timeoutMs = Number(values['timeout-ms']);
  if (!['pgn', 'jsonl'].includes(values.format)) throw new Error('Format must be pgn or jsonl.');
  if (!/^\d+$/.test(values.depth) || !Number.isSafeInteger(depth) || depth < 1 || depth > 128) throw new Error('Depth must be an integer from 1 to 128.');
  if (!/^\d+$/.test(values['timeout-ms']) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new Error('Timeout must be an integer from 1 to 2147483647.');
  const controller = new AbortController();
  let readingStdin = !values.input;
  const cancel = code => {
    process.exitCode = code;
    controller.abort();
    if (readingStdin) process.stdin.destroy(new Error('Input cancelled.'));
  };
  const cancelInt = () => cancel(130);
  const cancelTerm = () => cancel(143);
  process.on('SIGINT', cancelInt);
  process.on('SIGTERM', cancelTerm);
  const engine = createClassifierEngine({ command: values.engine, args: values['engine-arg'], timeoutMs });
  try {
    let pgn;
    if (values.input) pgn = await readFile(values.input, 'utf8');
    else {
      const parts = [];
      for await (const part of process.stdin) {
        if (controller.signal.aborted) throw new Error('Input cancelled.');
        parts.push(part);
      }
      pgn = Buffer.concat(parts).toString('utf8');
    }
    readingStdin = false;
    const result = await annotatePgn(pgn, { engine, depth, signal: controller.signal, includeRecords: values.records });
    const output = values.format === 'jsonl' ? renderJsonl(result) : renderAnnotatedPgn(result);
    if (values.output) await writeFile(values.output, output, 'utf8');
    else process.stdout.write(output);
    if (result.occurrences.some(item => item.status === 'unavailable') && !process.exitCode) process.exitCode = 2;
  } finally {
    await engine.close();
    process.removeListener('SIGINT', cancelInt);
    process.removeListener('SIGTERM', cancelTerm);
  }
}

main().catch(error => {
  process.stderr.write(`knights-eye-annotate: ${error.message}\n`);
  if (!process.exitCode) process.exitCode = 1;
});
