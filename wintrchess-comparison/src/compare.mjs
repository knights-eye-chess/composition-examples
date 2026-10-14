import { Chess } from 'chess.js';
import { createChessAnalyzerCore } from '@knights-eye-chess/move-classifier/core';
import { createKnightsEyePolicy } from '@knights-eye-chess/move-classifier/policy/knights-eye';
import { recordDecision, RECORDED_DECISION_SCHEMA } from '@knights-eye-chess/move-classifier/contracts';
import { createWintrChessPolicy } from './policy.mjs';
import { UPSTREAM_COMMIT } from './upstream.mjs';

const policyKey = policy => `${policy.id}@${policy.revision}`;
const occurrenceKey = occurrence => JSON.stringify([occurrence.startFen, occurrence.history]);

/** Engine evidence is shared only for identical search requests. Recorded
 * decisions use policy-scoped keys and are never passed in as live evidence. */
export function createComparisonRunner(engine, { depth = 8 } = {}) {
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 128) throw Error('Depth must be 1..128.');
  const searches = new Map(), decisions = new Map();
  let actualSearches = 0, reusedSearches = 0;
  const sharedEngine = { capabilities: engine.capabilities,
    async search(request) {
      const key = JSON.stringify([request.fen, request.depth, request.multiPv ?? 1, request.rootMoves ?? null]);
      if (searches.has(key)) { reusedSearches++; return structuredClone(searches.get(key)); }
      const value = await engine.search(request);
      searches.set(key, structuredClone(value)); actualSearches++;
      return value;
    },
  };
  const policies = [createKnightsEyePolicy(Chess), createWintrChessPolicy()];
  const analyzers = policies.map(policy => createChessAnalyzerCore(Chess, sharedEngine, policy));
  async function run(pgn, { signal } = {}) {
    if (typeof pgn !== 'string' || !pgn.trim() || (pgn.match(/^\s*\[Event\s/gm) ?? []).length > 1)
      throw Error('Expected one nonempty PGN game.');
    const game = new Chess(); game.loadPgn(pgn, { strict: true });
    const moves = game.history({ verbose: true });
    if (!moves.length || moves.length > 4096) throw Error('Expected one nonempty main-line game of at most 4096 plies.');
    const headers = game.getHeaders();
    if (headers.FEN && headers.SetUp !== '1' || headers.SetUp === '1' && !headers.FEN)
      throw Error('Custom-root PGN requires both [SetUp "1"] and [FEN "..."].');
    const startFen = new Chess(headers.SetUp === '1' ? headers.FEN : undefined).fen();
    const history = [], rows = [];
    for (const move of moves) {
      history.push(move.from + move.to + (move.promotion ?? ''));
      const occurrence = { startFen, history: [...history], beforeFen: move.before,
        afterFen: move.after, moveUci: history.at(-1) };
      const results = [];
      for (let index = 0; index < policies.length; index++) {
        const policy = policies[index].identity;
        const key = `${policyKey(policy)}:${occurrenceKey(occurrence)}`;
        let record = decisions.get(key);
        if (!record) {
          const result = await analyzers[index].analyzeAndClassify({ startFen, history: [...history], depth, signal });
          if (result.status !== 'complete') {
            results.push({ policy, status: result.status, reason: result.reason }); continue;
          }
          record = recordDecision({ schema: RECORDED_DECISION_SCHEMA, policy, occurrence,
            label: result.decision.classification, reasonCodes: [],
            candidateOrigins: result.before.candidates.slice(0, 3).map(line => ({
              uci: line.pv[0], origin: line.scoreProvenance ?? { kind: 'legacy-unknown' },
            })) });
          decisions.set(key, record);
        }
        results.push({ policy, status: 'complete', label: record.label, record,
          ...(policy.id.startsWith('wintrchess/') ? { upstreamCommit: UPSTREAM_COMMIT } : {}) });
      }
      rows.push({ ply: rows.length + 1, san: move.san, occurrence, decisions: results });
    }
    return { headers, rows,
      evidence: { actualSearches, reusedSearches }, policyIdentities: policies.map(item => item.identity) };
  }
  return { run, decisions, searches };
}

export function renderComparisonPgn(result) {
  const headers = Object.entries(result.headers).map(([name, value]) => `[${name} "${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`);
  const tokens = [];
  for (const row of result.rows) {
    if (row.ply % 2) tokens.push(`${(row.ply + 1) / 2}.`);
    const annotations = row.decisions.map(({ policy, status, label, reason }) =>
      `${policy.id}@${policy.revision}: ${status === 'complete' ? label : `unavailable (${reason})`}`);
    tokens.push(row.san, `{${annotations.join(' | ')}}`);
  }
  tokens.push(result.headers.Result ?? '*');
  return (headers.length ? headers.join('\n') + '\n\n' : '') + tokens.join(' ') + '\n';
}
