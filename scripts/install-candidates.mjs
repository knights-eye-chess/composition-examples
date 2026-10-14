#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

if (process.argv.length < 5) {
  console.error('Usage: node scripts/install-candidates.mjs MOVE_CLASSIFIER.tgz AI_ANALYSIS.tgz UCI_CLIENT.tgz');
  process.exit(2);
}
const archives = process.argv.slice(2).map(item => realpathSync(item));
execFileSync('npm', ['install', '--no-save', '--ignore-scripts', ...archives], { stdio: 'inherit' });
