import { Chess } from 'chess.js';
import { createChessAnalyzerCore } from '@knights-eye-chess/move-classifier/core';
import { createKnightsEyePolicy } from '@knights-eye-chess/move-classifier/policy/knights-eye';
import { recordDecision, RECORDED_DECISION_SCHEMA } from '@knights-eye-chess/move-classifier/contracts';

export const ANNOTATION_SCHEMA = 'pgn-annotation/1';
const REASONS = ['playedBest', 'forced', 'evasion', 'routine', 'tactical', 'sacrifice',
  'greatMove', 'mateMove', 'forcesMate', 'newlyAllowsMate', 'missedImmediateMate',
  'abandonedForcedMate', 'missedSpecial', 'missedMaterialOpportunity'];

/** One PGN game; chess.js deliberately selects its main line and ignores RAVs. */
export function parseMainLine(pgn) {
  if (typeof pgn !== 'string' || !pgn.trim()) throw new TypeError('Expected one nonempty PGN game.');
  // Multiple games must not silently collapse into one chess.js parse.
  if ((pgn.match(/^\s*\[Event\s/gm) || []).length > 1) throw new TypeError('Only one PGN game is supported.');
  const game = new Chess();
  game.loadPgn(pgn, { strict: true });
  const headers = game.getHeaders();
  if (headers.FEN && headers.SetUp !== '1') throw new TypeError('A custom-root FEN requires [SetUp "1"].');
  if (headers.SetUp === '1' && !headers.FEN) throw new TypeError('[SetUp "1"] requires a FEN.');
  const startFen = new Chess(headers.SetUp === '1' ? headers.FEN : undefined).fen();
  const moves = game.history({ verbose: true });
  if (moves.length > 4096) throw new RangeError('Main line exceeds the 4096-ply occurrence limit.');
  // Retain only main-line comments. Clear the parser's position-keyed comment map
  // when rendering: repeated board positions still need distinct annotations.
  return { headers, startFen, moves, game };
}

function originCandidates(decision) {
  return decision.candidates.slice(0, 3).map(line => ({
    uci: line.pv[0], origin: line.scoreProvenance || { kind: 'legacy-unknown' },
  }));
}

/** Compare only candidate scores from the admitted before-position root search.
 * An after-position search cannot estimate a missing played root candidate. */
function rootSearchLossCp(before, moveUci) {
  const best = before.candidates[0];
  if (best?.pv[0] === moveUci) return 0;
  const played = before.candidates.find(line => line.pv[0] === moveUci);
  if (!best || !played || best.mate !== null || played.mate !== null ||
    !Number.isFinite(best.scoreCp) || !Number.isFinite(played.scoreCp)) return null;
  const difference = best.scoreCp - played.scoreCp;
  return Number.isFinite(difference) ? Math.max(0, difference) : null;
}

function displayResult(outcome, occurrence, san, ply, includeRecords) {
  const base = { schema: ANNOTATION_SCHEMA, ply, san, occurrence, status: outcome.status };
  if (outcome.status === 'unavailable') return { ...base, reason: outcome.reason,
    message: outcome.message, ...(outcome.request ? { request: outcome.request } : {}) };
  const decision = outcome.decision;
  const reasonCodes = REASONS.filter(key => decision[key]);
  const whiteSign = new Chess(occurrence.afterFen).turn() === 'w' ? 1 : -1;
  const evaluation = outcome.after.terminal
    ? { perspective: 'white', cp: outcome.after.scoreCp === null ? null : whiteSign * outcome.after.scoreCp,
      mate: outcome.after.mate === null ? null : whiteSign * outcome.after.mate, terminal: true }
    : { perspective: 'white', cp: outcome.after.scoreCp === null ? null : whiteSign * outcome.after.scoreCp,
      mate: outcome.after.mate === null ? null : whiteSign * outcome.after.mate, depth: outcome.after.depth };
  const result = { ...base, policy: outcome.policy, label: decision.classification, evaluation,
    reasonCodes, lossCp: rootSearchLossCp(outcome.before, occurrence.moveUci),
    policyQualityLoss: decision.qualityLoss };
  if (includeRecords) result.record = recordDecision({ schema: RECORDED_DECISION_SCHEMA,
    policy: outcome.policy, occurrence, label: decision.classification, reasonCodes,
    candidateOrigins: originCandidates(decision) });
  return result;
}

/** Sequential exact-occurrence replay. Missing evidence never becomes a label.
 * Injected engines are structural AnalysisEngine objects, never stored records. */
export async function annotatePgn(pgn, { engine, depth = 12, signal, includeRecords = false, onOccurrence } = {}) {
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 128) throw new RangeError('Depth must be an integer from 1 to 128.');
  const parsed = parseMainLine(pgn);
  const analyzer = createChessAnalyzerCore(Chess, engine, createKnightsEyePolicy(Chess));
  const history = [], occurrences = [];
  for (const move of parsed.moves) {
    history.push(move.from + move.to + (move.promotion || ''));
    const occurrence = { startFen: parsed.startFen, history: [...history],
      beforeFen: move.before, afterFen: move.after, moveUci: history.at(-1) };
    const outcome = await analyzer.analyzeAndClassify({ startFen: parsed.startFen, history: [...history], depth, signal });
    const result = displayResult(outcome, occurrence, move.san, history.length, includeRecords);
    occurrences.push(result);
    await onOccurrence?.(result);
  }
  return { ...parsed, occurrences };
}

const safeComment = text => text.replace(/[{}\r\n]/g, ' ').trim();
function annotationComment(item) {
  if (item.status === 'unavailable') return `KE unavailable: ${item.reason}`;
  const score = item.evaluation.mate !== null ? `#${item.evaluation.mate}` : (item.evaluation.cp / 100).toFixed(2);
  return `KE ${item.label}; [%eval ${score}]; policy ${item.policy.id}@${item.policy.revision}; reasons ${item.reasonCodes.join(', ') || 'none'}`;
}

/** Render occurrence comments directly, rather than chess.js's FEN-keyed map. */
export function renderAnnotatedPgn(result) {
  const headerLines = Object.entries(result.headers).map(([key, value]) =>
    `[${key} "${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`);
  const tokens = [];
  const rootComment = result.game.getComments().find(item => item.fen === result.startFen)?.comment;
  if (rootComment) tokens.push(`{${safeComment(rootComment)}}`);
  let number = Number(result.startFen.split(' ')[5]);
  let color = result.startFen.split(' ')[1];
  for (let index = 0; index < result.moves.length; index++) {
    if (color === 'w') tokens.push(`${number}.`);
    else if (index === 0) tokens.push(`${number}...`);
    tokens.push(result.moves[index].san);
    const existing = result.game.getComments().find(item => item.fen === result.moves[index].after)?.comment;
    const comment = [existing, annotationComment(result.occurrences[index])].filter(Boolean).join(' | ');
    tokens.push(`{${safeComment(comment)}}`);
    if (color === 'b') number++;
    color = color === 'w' ? 'b' : 'w';
  }
  tokens.push(result.headers.Result || '*');
  return (headerLines.length ? headerLines.join('\n') + '\n\n' : '') + tokens.join(' ') + '\n';
}

export function renderJsonl(result) {
  return result.occurrences.map(item => JSON.stringify(item)).join('\n') + (result.occurrences.length ? '\n' : '');
}
