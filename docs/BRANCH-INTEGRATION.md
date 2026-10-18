# Branch integration

Checked 2026-10-18T06:10:28Z. Every fetched remote branch and local branch is an ancestor of the integrated `main` at `d55fab8`. Historical `work/*` and `coordination` tips were already included; no branches were deleted or force-pushed.

Merged buyer fixes, human Stripe buyer setup, pending-runner rendering, both optional viewers, E’s demo updates, and the saved autonomous buyer code. The runtime conflict preserves both viewer support and private identity/state locking. The installer includes the viewer HTML and the lockfile includes the VM viewer workspace.

Verification: workspace typecheck; 253 tests passed, 2 optional Wassette tests skipped; hosted web and MCP builds passed; VM viewer scripts passed syntax checks; packaged viewer HTML exists. No benchmark, live task, provider call, worker restart or spending-limit change was performed. This is source integration evidence, not a new deployment or completion of unified onboarding.

| Branch | Tip | Included |
| --- | --- | --- |
| `feat/ac-task-offers` | `4771da3` | Yes |
| `feat/c-autonomous-buyer` | `b77793e` | Yes |
| `feat/c-jobs-integration` | `f7d52a3` | Yes |
| `feat/c-owner-integration` | `df1d457` | Yes |
| `feat/c-runtime-metrics` | `c0099ef` | Yes |
| `feat/c-seller` | `700f952` | Yes |
| `feat/c-seller-onboarding` | `961f2a9` | Yes |
| `feat/c-task-pricing` | `2e74276` | Yes |
| `feat/c-unified-onboarding` | `5c8f704` | Yes |
| `origin/claude/hopeful-dirac-yjn1ae` | `a49cbb1` | Yes |
| `origin/claude/zen-mccarthy-0xradq` | `147d78e` | Yes |
| `origin/codex/b-hosted-runner-state` | `149a581` | Yes |
| `origin/coordination` | `2e25a9d` | Yes |
| `origin/feat/ac-task-offers` | `d276dc7` | Yes |
| `origin/feat/b-buyer` | `d4672e3` | Yes |
| `origin/feat/c-autonomous-buyer` | `b77793e` | Yes |
| `origin/feat/c-runtime-metrics` | `c0099ef` | Yes |
| `origin/feat/c-seller` | `7d75ab2` | Yes |
| `origin/feat/c-seller-onboarding` | `961f2a9` | Yes |
| `origin/feat/c-task-pricing` | `2e74276` | Yes |
| `origin/feat/d-payments` | `8a64c72` | Yes |
| `origin/feat/e-judge-inkbox` | `c0730c4` | Yes |
| `origin/main` | `9e416e3` | Yes |
| `origin/work/A-api` | `2e25a9d` | Yes |
| `origin/work/B-buyer` | `2e25a9d` | Yes |
| `origin/work/C-seller` | `2e25a9d` | Yes |
| `origin/work/D-security` | `2e25a9d` | Yes |
| `origin/work/E-judge` | `2e25a9d` | Yes |
