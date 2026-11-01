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

## Implementation status

At baseline `7825b2a95d767b07b57327f5928fbbb18af55197` (upstream
`df4ceba5e08220db670c25afead342ce699c50b5`), the inventory covers 145 unique upstream
Core-registered function names: 11 implemented in the supported slice, 4 partial, 129 missing,
and 1 deliberately excluded (`Patch`, a host mutation operation). Upstream has additional
host/runtime-known names outside this count; see the [full inventory](docs/research/powerfx-coverage-inventory.md)
for scope, overloads, sources and counting rules.

Compatibility corpus results: `v1-float` 2,228 pass / 1 fail / 46 skip / 12,684 unsupported;
`v1-decimal` 2,758 / 1 / 56 / 13,358. These are outcomes on a finite, profile-dependent corpus,
not percentages of language completeness or effort completed. The expression runtime is a useful
but narrow V1 slice; authoring services are scaffolds, and Monaco/React, PCF, LSP, connectors and
gateway integrations are not implemented. Future milestone PRs should update the function inventory
and both profile reports together; do not infer an overall completion percentage.

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

Table access: `First(Filter(Table({Score: 90}, {Score: 50}), Score > 80)).Score` is `90`,
`CountRows(...)` counts rows, and `LookUp(T As item, item.Score > 80, item.Score)` returns the first
match's result formula (see ADR 0007).

Record/table unions: `If` results, `Table(...)` arguments and table literals with differing record
types union field by field (missing fields are Blank; same-name Number/Text/Boolean fields coerce to
the left type) through explicit `Conform` nodes (see ADR 0008).

Decimal: `new Engine({ numberMode: "decimal" })` evaluates with a 28-digit, 96-bit decimal
backend (`0.1+0.2` is exactly `0.3`; `Decimal()`/`Float()` convert explicitly). The default is still
float. Decimal host inputs are decimal strings, `bigint` or safe integers; imprecise JS numbers are
rejected. `Decimal()`, `Float()` and `Value()` parse culture-aware text (`"$1,000"`, `"(12)%"`, optional locale: en-US and fr-FR only; other locales are reported as unsupported, see ADR 0010).

Diagnostics: an out-of-range numeric literal (`1E400` float, `1E100` decimal) keeps the type Error, so
its operator, conversion call or comparison reports upstream's cascaded "invalid argument type"
diagnostics. Eager binary operators evaluate both operands and merge the errors of both (a two-error
result serializes as `Error(Table(...))`); see ADR 0011.

See `docs/adr/0004-typed-context.md`, `0005-record-literals-and-with.md` and
`0006-tables-and-row-scopes.md` for rules and limitations.
