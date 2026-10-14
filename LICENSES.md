# License layout

This repository contains separate executable examples and has no single blanket
source license. Each example directory has its own `LICENSE`:

| Example | License | Source and linked code |
| --- | --- | --- |
| `engine-only/` | MIT | New host code; consumes the MIT UCI client. |
| `annotation/` | MIT | CLI and annotation flow moved from `pgn-annotator` (MIT); consumes MIT classifier and client. |
| `ai-cli/` | AGPL-3.0-or-later | CLI, answer runner and connectors moved from `cli-tools` (AGPL-3.0-or-later); consumes `ai-analysis` (AGPL-3.0-or-later). |
| `wintrchess-comparison/` | GPL-3.0-only | Adapter and runner linked with unmodified WintrChess source at the pinned commit. |

`scripts/classifier-engine.mjs` is MIT and used by annotation and comparison;
when linked into the WintrChess executable, the GPL obligations also apply to
that combined work. `scripts/install-candidates.mjs`, package metadata and
top-level documentation are MIT. The examples are separate processes; the
AGPL AI CLI does not import or bundle WintrChess. WintrChess is fetched only for
its own build and never enters MIT component packages.

WintrChess source: <https://github.com/WintrCat/wintrchess>, pinned at
`d145b20968955ca955cafe3fc3b51305f3bf41f9`; its original license is
GPL-3.0. The local build uses the original source without edits. The MIT
Knight's Eye package licenses and AGPL AI package license are supplied by
their respective installed packages.
