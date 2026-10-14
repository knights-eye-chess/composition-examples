import { Chess } from 'chess.js';
import { runAnswerPipeline, createProductionObservationProvider, validateReasoningPositionContext,
  QUESTION_ROUTING_VERSION, simpleSystemPolicy, simpleToolDescription } from '@knights-eye-chess/ai-analysis';
import { runDelegated } from './connectors.mjs';

/** Exact occurrence, not a final-FEN substitute for history. */
export function prepareContext({ pgn, fen, ply, scope = 'move', question }) {
  if (typeof question !== 'string' || !question.trim()) throw Error('A question is required.');
  if ((typeof pgn === 'string') === (typeof fen === 'string')) throw Error('Provide exactly one PGN or starting FEN.');
  if (!['move', 'position', 'game', 'general', 'mixed'].includes(scope)) throw Error('Invalid question scope.');
  const game = new Chess();
  if (pgn !== undefined) game.loadPgn(pgn, { strict: true });
  else game.load(fen);
  const history = game.history({ verbose: true });
  const startFen = history[0]?.before ?? game.fen();
  const at = ply ?? history.length;
  if (!Number.isSafeInteger(at) || at < 0 || at > history.length) throw Error('Selected ply is outside the main line.');
  const uci = move => move.from + move.to + (move.promotion ?? '');
  const selected = history[at - 1];
  const context = selected ? { nodeId: 'local:' + at, parentNodeId: 'local:' + (at - 1),
    historyStartFen: startFen, historyUci: history.slice(0, at - 1).map(uci),
    fenBefore: selected.before, fenAfter: selected.after, moveUci: uci(selected), moveSan: selected.san }
    : { kind: 'position', nodeId: 'local:0', historyStartFen: startFen, historyUci: [],
      fenBefore: startFen, fenAfter: startFen, moveUci: '', moveSan: '' };
  validateReasoningPositionContext(context);
  const mainLine = { startFen, moves: history.map((move, index) => ({ uci: uci(move), san: move.san, edgeId: 'local:' + (index + 1) })),
    selectedIndex: at - 1, selectedAtStart: at === 0, totalPlies: history.length, truncated: false };
  return { context, mainLine, scope, question };
}

/** UCI output remains attributed to its actual engine and root; short PVs stay short. */
export async function answerQuestion(job, options = {}) {
  options.signal?.throwIfAborted();
  const prepared = prepareContext(job);
  if (options.mode === 'delegated') return runDelegated({ ...options.delegated, context: prepared.context,
    question: job.question, signal: options.signal });
  if (options.mode && options.mode !== 'controlled') throw Error('Unknown execution mode.');
  if (!options.connector || options.connector.kind !== 'model-turn') throw Error('A model-turn connector is required.');
  const id = options.requestId ?? 'local-answer';
  const selected = { deliveryId: id, selectionKey: prepared.context.nodeId, edgeId: prepared.context.nodeId,
    context: prepared.context, existingAnalysis: null };
  const scopeChoice = { move: 'move_explanation', position: 'position_analysis', game: 'game_review', general: 'general', mixed: 'mixed' }[prepared.scope];
  const omitSelectedContext = prepared.scope === 'general';
  const routing = { question: job.question, selectionKey: selected.selectionKey, deliveryId: selected.deliveryId,
    elapsedMs: 0, omitSelectedContext, ...(prepared.scope === 'game' ? { mainLine: prepared.mainLine } : {}),
    decision: { version: QUESTION_ROUTING_VERSION, status: 'fallback', reason: 'explicit-host-scope-no-Jev',
      omitSelectedContext, includeGameRecord: prepared.scope === 'game', reviewGame: prepared.scope === 'game',
      answers: { answer_scope: { choice: scopeChoice, confidence: 1 } } } };
  const result = await runAnswerPipeline({ requestId: id, question: job.question, selected,
    connector: options.connector, policy: options.policy ?? { system: simpleSystemPolicy, description: simpleToolDescription },
    modelName: options.modelName ?? 'local-connector', analyzer: options.analyzer, signal: options.signal,
    prepareRouting: async () => routing,
    bridge: { getMainLine: async () => prepared.mainLine },
    observationProvider: createProductionObservationProvider({ context: prepared.context, question: job.question }),
    onProgress: options.onProgress, observableTraceSink: options.observableTraceSink });
  options.signal?.throwIfAborted();
  return { schema: 'controlled-answer/1', mode: 'controlled', result,
    context: prepared.context, connectorCapabilities: options.connector.capabilities ?? null,
    qualification: { policy: options.policy ? 'host-injected' : 'package-base-not-website-prompt-identity',
      routing: 'explicit-host-scope-not-Jev', answerQuality: 'not-equivalence-qualified',
      usage: result.usage?.metering ?? 'unavailable' } };
}

export async function* answerBatch(jobs, options) {
  let index = 0;
  for await (const job of jobs) {
    options.signal?.throwIfAborted();
    yield await answerQuestion(job, { ...options, requestId: 'batch:' + (++index) });
  }
}
