import { Chess } from 'chess.js';
import { classify } from '../dist/wintrchess-classify.mjs';
import { UPSTREAM_COMMIT } from './upstream.mjs';

// The classifier contract has a numeric revision. Use the pinned commit's
// 48-bit prefix here and retain its full SHA with each WintrChess result.
export const WINTRCHESS_IDENTITY = Object.freeze({ id: 'wintrchess/full-classify',
  revision: Number.parseInt(UPSTREAM_COMMIT.slice(0, 12), 16) });

function engineLines(analysis, fen) {
  const side = fen.split(' ')[1] === 'w' ? 1 : -1;
  return analysis.candidates.map((candidate, index) => ({
    source: 'stockfish', depth: candidate.depth, index: index + 1,
    evaluation: candidate.mate === null
      ? { type: 'centipawn', value: side * candidate.scoreCp }
      : { type: 'mate', value: side * candidate.mate },
    moves: (() => { const board = new Chess(fen); return candidate.pv.map(uci => ({
      san: board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4),
        ...(uci[4] ? { promotion: uci[4] } : {}) })?.san ?? '',
    })); })(),
  }));
}

function nodePair(context) {
  const move = context.move;
  const before = { id: 'before', mainline: true, children: [], state: {
    fen: context.beforeFen, engineLines: engineLines(context.beforeAnalysis, context.beforeFen),
  } };
  const afterLines = context.afterAnalysis.terminal ? [{ source: 'stockfish', depth: context.afterAnalysis.depth,
    index: 1, evaluation: context.afterAnalysis.mate === 0
      ? { type: 'mate', value: move.color === 'w' ? 1 : -1 }
      : { type: 'centipawn', value: 0 }, moves: [] }]
    : engineLines(context.afterAnalysis, context.afterFen);
  const after = { id: 'after', mainline: true, children: [], parent: before, state: {
    fen: context.afterFen, move: { san: move.san, uci: move.uci },
    engineLines: afterLines,
  } };
  before.children.push(after);
  return after;
}

/** Independent external policy on the public AnalysisPolicy contract. */
export function createWintrChessPolicy() {
  return {
    identity: WINTRCHESS_IDENTITY,
    terminal(fen, depth) {
      const chess = new Chess(fen);
      if (chess.moves().length) return null;
      return { multipv: 1, depth, scoreCp: chess.isCheckmate() ? null : 0,
        mate: chess.isCheckmate() ? 0 : null, pv: [], bestmove: '', candidates: [], terminal: true };
    },
    legalCount: fen => new Chess(fen).moves().length,
    materialExchangeForMove: () => null,
    exchange: () => ({ inherited: false, originFen: '' }),
    offer: () => ({ candidates: [], verification: null }),
    verify: () => null,
    verificationSatisfies: () => true,
    priorPoints: () => 0,
    classify(context) { return { classification: classify(nodePair(context)) }; },
  };
}
