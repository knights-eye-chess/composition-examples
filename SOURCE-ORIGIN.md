# Source origin

The example host code was moved from these component snapshots on 14 October
2026. It is maintained here as executable composition code, while reusable
classification, answer and UCI implementation remains in installed packages.

| Destination | Source snapshot | Changes |
| --- | --- | --- |
| `annotation/annotate.mjs`, `annotation/cli.mjs` | `@knights-eye-chess/pgn-annotator` `0.1.0-dev.17`, `src/annotate.mjs` and `src/cli.mjs` (MIT) | CLI imports the public UCI client through a structural classifier adapter. |
| `ai-cli/cli.mjs`, `runner.mjs`, `connectors.mjs`, `process-transport.mjs` | `@knights-eye-chess/cli-tools` `0.1.0-dev.20`, same filenames under `src/` (AGPL-3.0-or-later) | Local analyzer mapping moved to the AI package's public `/engine` entry; CLI owns and closes the UCI client. |
| `wintrchess-comparison/dist/wintrchess-classify.mjs` | WintrChess `shared/src/lib/reporter/classify.ts` and transitive source at `d145b20968955ca955cafe3fc3b51305f3bf41f9` (GPL-3.0) | Build output only; source checkout is unchanged and ignored. |

The executable examples import only package exports, never the source paths
listed above. The source paths in this document record provenance, not runtime
dependencies.
