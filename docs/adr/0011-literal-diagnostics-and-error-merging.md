# ADR 0011: Cascaded literal diagnostics and combined operand errors

Status: accepted (compatibility cleanup, after PR #9). Pinned upstream `df4ceba5`.

## Context

Two compatibility gaps remained after ADR 0010 (baseline: 2 failures in `v1-float`, 37 in
`v1-decimal`):

1. A numeric literal outside the numeric kind's range was reported once and then ignored; upstream
   gives it the type Error and every consumer adds its own diagnostic.
2. `Decimal(big) / Decimal(big)` produced one error; upstream produces two, serialized as
   `Error(Table({...},{...}))`.

## Decisions

### Literal cascade (binder)

- The lexer marks the Error token (`numberTooLarge`), the parser propagates it, and the binder emits
  an `Invalid` node with `errorTyped: true`. This is the only Error-typed node. Plain syntax errors
  stay silent and Unknown-typed, as before.
- Consumers report what the pinned reference prints (verified with the harness `check` command, which
  lists every compile error): operator accepted-type lists (`+ - * / ^ & && || ! % unary-`, each
  side independently; lists are in the binder), ordering operators (existing PFX2006 text),
  `=`/`<>` (one "Incompatible types for comparison" at the operator, `Error, Number`), and
  `Value`/`Decimal`/`Float` (call-name "invalid arguments" + "Expected text or number" at the
  argument, or "Expected text" for the locale argument).
- The enclosing node returns a well-typed result, so Errors do not propagate: `(1 + 1E100) * 2`
  yields only the two diagnostics of `1 + 1E100`. The same rule holds in both profiles; float
  overflows at ~1e309, decimal at 7.9e28 (the corpus uses `1E400` / `1E100` equivalents).
- Corpus entries list only a subset of the reference's diagnostics; the runner checks containment, so
  emitting all of them (e.g. both operands of `big / big`) is compatible and matches the reference.

### Combined operand errors (evaluator)

Upstream's `Visit(BinaryOpNode)` evaluates both operands and `StandardErrorHandling` returns
`ErrorValue.Combine` of all Error operands in order. Eager operators (arithmetic, `^`, comparisons,
`&`, `=`/`<>`) now do the same; `&&`/`||` stay lazy. A single failing operand yields that error
unchanged. Budget ticks and cancellation checks still happen per evaluated node, so the extra right
operand evaluation is charged. Merged errors are deep-frozen.

The test-suite value serializer follows `ErrorValue.ToExpression` (compact): several errors print as
`Error(Table({Kind:..},{Kind:..}))`. This is an adapter change, not a verdict change.

## Known gaps / deliberate deviations

- Consumers not yet implemented in our binder (e.g. `If(1E100, ...)` condition diagnostics, other
  functions) report only the literal diagnostic. No corpus case or reference vector requires them.
- `Text()` formatting (`Text_ExcelCompat_PowerFxV1Compat.txt:13`) and float `^` last-ulp
  differences remain out of scope.

Evidence: `docs/research/compat-cleanup-before-after.md`.
