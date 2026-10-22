# Navigation contract

Stable module IDs and labels are defined in `artifacts/allocation-lab/src/research/state.ts`:

| Order | ID | Module | Execution |
|---|---|---|---|
| 1 | data | Data & Universe | Coming |
| 2 | signals | Signals | Coming |
| 3 | health | Signal Health | Coming |
| 4 | capital | Capital Exposure | Active |
| 5 | etf | ETF Selection | Coming |
| 6 | portfolio | Portfolio Optimization | Coming |
| 7 | robustness | Robustness & Stress | Coming |
| 8 | promote | Compare & Promote | Coming |

The ordered top navigation is the portfolio-construction workflow indicator. Active state is explicit; on narrow screens the rail scrolls internally and centers the current module. Opening a coming module only displays “Module not yet enabled” and one sentence describing its eventual purpose. It has no inputs, execution action, fake data or mock results. No future module is advertised by backend capabilities as executable.

The shell owns identity, access and global research limitations. Module views own their research controls. Future module implementations may bind these stable IDs to views without replacing the shell. Capital Exposure tabs are Setup, Results, Compare, Runs and Audit. Navigation alone never submits research. Modules are local views within `/workbench`; standalone future deep links are not implemented.

Future conceptual contracts: Signal Library → Signal Health → Active Strategy Set → Capital Exposure → ETF/Strategy Allocation → Exposure Controller → Robustness → Certified Portfolio. These are architecture boundaries, not current executable capabilities. Promotion is not trading authorization.
