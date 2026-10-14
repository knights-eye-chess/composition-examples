#!/usr/bin/env node
// Deterministic JSON model-turn fixture: exercises the CLI without a provider.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const envelope = JSON.parse(input);
if (envelope.schema !== 'knights-eye/model-turn/1') throw Error('Unexpected model-turn request.');
process.stdout.write(JSON.stringify({ text: 'No independent engine evaluation was requested.', toolCalls: [] }) + '\n');
