#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createJsonProcessConnector, createCodexConnector, createClaudeConnector } from './connectors.mjs';
import { answerBatch } from './runner.mjs';
import { createEngineAnalysisProvider } from '@knights-eye-chess/ai-analysis/engine';
import { createProcessEngine } from '@knights-eye-chess/uci-client/node';

const args = process.argv.slice(2), values = {}, extra = [], engineArgs = [];
function usage() { console.log('knights-eye-answer --input game.pgn|--fen FEN --question TEXT [--ply N --scope move|position|game|mixed|general]\n  or --batch jobs.jsonl; --connector codex|claude|json [--command executable --arg ARG]\n  [--mode controlled|delegated --engine executable --engine-arg ARG --model MODEL --timeout MS]\n  JSONL output; external CLI authentication remains CLI-owned.'); }
if (args.includes('--help')) { usage(); process.exit(0); }
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!['--input', '--fen', '--question', '--ply', '--scope', '--batch', '--connector', '--command', '--arg', '--mode', '--engine', '--engine-arg', '--model', '--timeout'].includes(key) || i + 1 >= args.length) throw Error('Unknown or missing CLI argument: ' + key);
  const value = args[++i];
  if (key === '--arg') extra.push(value); else if (key === '--engine-arg') engineArgs.push(value);
  else { if (values[key] !== undefined) throw Error('Repeated CLI argument: ' + key); values[key] = value; }
}
const controller = new AbortController();
let cancelledCode = 0;
const cancel = code => { cancelledCode = code; controller.abort(Error('CLI cancelled.')); };
const onInt = () => cancel(130), onTerm = () => cancel(143);
process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
let analyzer, engineClient;
try {
  const kind = values['--connector'] ?? 'codex', mode = values['--mode'] ?? 'controlled';
  if (!['codex', 'claude', 'json'].includes(kind)) throw Error('Unknown connector.');
  if (!['controlled', 'delegated'].includes(mode)) throw Error('Unknown execution mode.');
  const timeoutMs = values['--timeout'] === undefined ? 120000 : Number(values['--timeout']);
  const command = values['--command'] ?? kind;
  const config = { command, args: extra, timeoutMs, model: values['--model'] };
  const connector = kind === 'json' ? createJsonProcessConnector(config) : kind === 'claude' ? createClaudeConnector(config) : createCodexConnector(config);
  if (mode === 'controlled' && values['--engine']) {
    engineClient = createProcessEngine({ command: values['--engine'], args: engineArgs });
    analyzer = createEngineAnalysisProvider(engineClient);
  }
  let jobs;
  if (values['--batch']) {
    if (['--input', '--fen', '--question', '--ply', '--scope'].some(key => values[key] !== undefined)) throw Error('Batch and single-job inputs are mutually exclusive.');
    const input = await readFile(values['--batch'], 'utf8');
    jobs = input.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  } else jobs = [{ ...(values['--input'] ? { pgn: await readFile(values['--input'], 'utf8') } : {}),
    ...(values['--fen'] ? { fen: values['--fen'] } : {}), question: values['--question'],
    ...(values['--ply'] !== undefined ? { ply: Number(values['--ply']) } : {}), scope: values['--scope'] ?? 'move' }];
  for await (const result of answerBatch(jobs, { connector, mode, analyzer, signal: controller.signal,
    delegated: { ...config, kind } })) console.log(JSON.stringify(result));
} catch (error) {
  console.error(cancelledCode ? 'CLI cancelled.' : error.message);
  process.exitCode = cancelledCode || 1;
} finally {
  await engineClient?.close(); process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
}
