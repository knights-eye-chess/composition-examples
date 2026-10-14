import { createProcessEngine } from '@knights-eye-chess/uci-client/node';

/** The classifier's structural search interface uses depth directly. */
export function createClassifierEngine(options) {
  const client = createProcessEngine(options);
  return {
    capabilities: { multiPv: true, rootMoves: true },
    search({ fen, depth, multiPv, rootMoves, signal }) {
      return client.search({ fen, limit: { depth }, multiPv, rootMoves, signal });
    },
    close: () => client.close(),
  };
}
