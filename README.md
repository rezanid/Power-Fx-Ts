# powerfx-ts

A safe, strongly typed expression engine for TypeScript/JavaScript, compatible with Microsoft Power
Fx. Not affiliated with Microsoft. See `docs/PowerFx-TypeScript-Plan.md` for the plan.

## Layout

| Path                        | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `packages/core`             | Spans, diagnostics, lexer, parser, types, binder, IR |
| `packages/interpreter`      | Values, evaluator, built-in implementations          |
| `packages/engine`           | Check/evaluate API, dependencies, recalculation      |
| `packages/language-service` | Editor-neutral completion, signatures, hover         |
| `packages/serialization`    | Versioned schema/value DTOs                          |
| `packages/test-runner`      | Headless expression test sessions                    |
| `packages/test-suite`       | Upstream compatibility runner and reports            |
| `docs/adr`, `docs/research` | Decisions and upstream research                      |
| `upstream`                  | Pinned upstream checkout (git-ignored)               |

## Commands

`pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check`

Compatibility run (needs the pinned upstream checkout in `upstream/Power-Fx`, see
`docs/research/upstream-inventory.md`):
`pnpm --filter @powerfx-ts/test-suite compat v1-float` writes `packages/test-suite/reports/`.
Cases the engine cannot yet handle are reported as `unsupported`, never as passes.
