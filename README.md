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

## Typed context

```ts
const schema = defineSchema({ Customer: recordType({ RiskScore: NumberType }) });
const engine = new Engine();
const checked = engine.check('If(Customer.RiskScore > 80, "High", "Normal")', { schema }); // no values
const v = engine.validateValues(schema, { Customer: { RiskScore: 90 } });
if (v.ok) await engine.evaluateChecked(checked, { values: v.values }); // "High"
```

Record literals and `With` work too, e.g.
`With({Score: Customer.RiskScore}, If(Score > 80, "High", "Normal"))`.

Tables and row scopes: `Filter(Table({Score: 90}, {Score: 50}) As item, item.Score > 80)` returns
`Table({Score:90})`; `ThisRecord`, `As`, table literals (`[...]`) and `Table(...)` share the same
binder and evaluator.

See `docs/adr/0004-typed-context.md`, `0005-record-literals-and-with.md` and
`0006-tables-and-row-scopes.md` for rules and limitations.
