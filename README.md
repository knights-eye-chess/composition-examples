# Knight's Eye composition examples

Four Node 24+ examples show how to combine installed Knight's Eye public
packages without importing application source. This is a local, unpublished
example repository. The examples are executable tools, not a release gate for
the app. The [license layout](LICENSES.md) applies per example.

## Setup before coordinated package publication

```sh
node scripts/install-candidates.mjs /path/to/move-classifier.tgz /path/to/ai-analysis.tgz /path/to/uci-client.tgz
npm run build:wintrchess
npm test
```

The exact candidate graph tested here is move-classifier `0.1.0-dev.15`,
ai-analysis `0.1.0-dev.20`, and uci-client `0.1.0-dev.1`. These versions are
local release candidates and are not yet on npm. Pass all three reviewed
archives in one invocation; npm's `--no-save` install otherwise restores the
older published versions from `package.json` on the next install. The checked-in
root lockfile records those older published versions and does not make `npm ci`
usable for these new examples yet. Once the graph is published, its exact
registry dependencies and lockfile must be updated together and verified with
`npm ci` from a clean checkout.

Do not edit installed package files or use sibling source aliases. `build:wintrchess`
sparse-checks out its exact upstream commit into ignored `.upstream/` and
bundles `shared/src/lib/reporter/classify.ts` as-is with esbuild.

Provide a UCI engine separately, normally Stockfish, through `--engine`.
Stockfish and Lc0/Maia binaries or weights are not included here.

```sh
node engine-only/cli.mjs --engine stockfish --depth 8
node annotation/cli.mjs --input fixtures/example.pgn --engine stockfish --depth 8 --format jsonl --records
node ai-cli/cli.mjs --fen 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' --question 'Assess this position' --connector json --command /path/to/your/model-turn-cli
node wintrchess-comparison/cli.mjs --input fixtures/sacrifice.pgn --engine stockfish --depth 8 --format pgn
```

For an offline wiring smoke, replace the model command with
`--command node --arg ai-cli/fixed-turn.mjs`. The fixed connector gives a
deterministic placeholder answer; it does not assess chess quality.

The AI CLI's `codex`, `claude` and JSON process connectors use external CLI
authentication. Running them may incur provider charges; no model call occurs
during the local build or tests. `--mode delegated` attributes investigation
to the external agent and does not claim Knight's Eye validation. Controlled
mode uses `prepareContext`, `answerQuestion` and the AI package's engine adapter.

## Adding a policy

Implement the public `AnalysisPolicy` contract and inject it into
`createChessAnalyzerCore` from `@knights-eye-chess/move-classifier/core`.
Return a distinct `{id, revision}` policy identity. The WintrChess adapter
maps the admitted before and after searches to its `StateTreeNode` inputs,
including top and second lines and white-relative scores, then calls its
original full `classify`. Its contract revision is the numeric 48-bit prefix
of the pinned SHA; records also carry the full SHA. Another policy can use
the same core and engine without changing Knight's Eye or the app.

The comparison runner memoizes *completed engine searches* by full request
(FEN, depth, MultiPV and root moves). The policy cores keep their own evidence
caches. Display records have keys containing policy ID, revision and exact move
occurrence; they are never used as search evidence. Knight's Eye may require
additional restricted verification searches. Those are visible as distinct
request keys and cannot be assumed shareable with WintrChess.

`fixtures/sacrifice.pgn` comes from the existing modularity phase-04 chess
fixture. A one-move comparison with deterministic engine evidence is tested
locally. The historical 1,148-move WintrChess comparison and its 9 of 17
Brilliant-hit count require the original reviewed corpus and Stockfish 19
settings, which are not part of this repository; this example does not claim
to reproduce those counts.
