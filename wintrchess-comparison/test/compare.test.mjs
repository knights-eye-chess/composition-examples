import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { readFile } from 'node:fs/promises';
import { createComparisonRunner, renderComparisonPgn } from '../src/compare.mjs';
import { WINTRCHESS_IDENTITY } from '../src/policy.mjs';
import { UPSTREAM_COMMIT } from '../src/upstream.mjs';

function fakeEngine() {
  let calls = 0;
  return { capabilities: { multiPv: true, rootMoves: true }, get calls() { return calls; },
    async search({ fen, depth, multiPv, rootMoves }) {
      calls++;
      const board = new Chess(fen);
      const legal = board.moves({ verbose: true }).map(move => move.from + move.to + (move.promotion ?? ''));
      const roots = rootMoves ?? [...legal].sort((a, b) => (a === 'e2e4' ? -1 : b === 'e2e4' ? 1 : a.localeCompare(b))).slice(0, multiPv);
      const candidates = roots.map((uci, index) => ({ multipv: index + 1, depth,
        scoreCp: index === 0 ? 40 : 10 - index, mate: null, pv: [uci],
        scoreProvenance: { kind: 'root-search', fen, originatingDepth: depth,
          reportedDepth: depth, engineBuild: 'fake-test-engine' } }));
      return { ...candidates[0], bestmove: candidates[0].pv[0], candidates };
    } };
}

test('full pinned WintrChess classify and Knight’s Eye produce distinct recorded policies', async () => {
  const engine = fakeEngine();
  const runner = createComparisonRunner(engine, { depth: 2 });
  const first = await runner.run('1. e4 *');
  assert.equal(first.rows.length, 1);
  const [knightsEye, wintrchess] = first.rows[0].decisions;
  assert.equal(knightsEye.status, 'complete');
  assert.equal(wintrchess.status, 'complete');
  assert.equal(wintrchess.policy.id, WINTRCHESS_IDENTITY.id);
  assert.equal(wintrchess.upstreamCommit, UPSTREAM_COMMIT);
  assert.notDeepEqual(knightsEye.policy, wintrchess.policy);
  assert.equal(runner.decisions.size, 2);
  assert.ok([...runner.decisions.keys()].every(key => key.startsWith('knights-eye/') || key.startsWith('wintrchess/')));
  assert.equal(wintrchess.record.policy.id, 'wintrchess/full-classify');
  assert.match(renderComparisonPgn(first), /wintrchess\/full-classify@\d+: \w+/);
  const calls = engine.calls;
  await runner.run('1. e4 *');
  assert.equal(engine.calls, calls);
  assert.equal(runner.decisions.size, 2);
});

test('corpus fixture renders each main-line move with both policy identities', async () => {
  const pgn = await readFile(new URL('../../fixtures/sacrifice.pgn', import.meta.url), 'utf8');
  const result = await createComparisonRunner(fakeEngine(), { depth: 2 }).run(pgn);
  assert.equal(result.rows.length, 24);
  assert.ok(result.rows.every(row => row.decisions.length === 2));
  assert.ok(result.rows.every(row => row.decisions.every(decision => decision.status === 'complete')));
  assert.ok(result.evidence.reusedSearches > 0);
  assert.match(renderComparisonPgn(result), /9\. Nxe4/);
});
