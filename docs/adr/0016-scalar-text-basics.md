# ADR 0016: Scalar `Len`, `Lower`, and `Upper`

Status: **accepted, implemented, locally verified; PR CI passed**. Baseline:
`767321b122080991929dde50382d663dc306ac17`. Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`. Scope:
`docs/milestones/0016-scalar-text-basics-milestone-spec.md`.

## Decision

Implement one-argument scalar `Len`, `Lower`, and `Upper` in the shared signature registry and
interpreter:

- Accept Text, Number, Decimal, Boolean, and Blank. Reuse the explicit scalar-to-Text coercion
  nodes; these preserve reached Error values and convert Blank to empty Text.
- `Len` counts UTF-16 code units, matching .NET `String.Length` (`Len("😀")` is 2). Its static and
  runtime result is Number in the float profile and Decimal in the decimal profile.
- `Lower` and `Upper` use a generated, frozen en-US simple-case table rather than JavaScript
  casing APIs. This avoids host ICU/Unicode-version drift, contextual casing and multi-character
  expansions that do not match the pinned reference behavior.
- Reject record arguments with the precise `BadTypeExpected` diagnostic plus the generic
  `InvalidFunctionArguments` diagnostic. Keep table-typed calls explicitly unsupported because
  their upstream table overloads are outside this scalar milestone.

The casing table is generated and exhaustively verified against installed .NET en-US
`TextInfo` behavior for all Unicode scalar values. The pinned Power Fx source calls
`runner.CultureInfo.TextInfo`; the upstream commit does not pin the .NET globalization provider.
The checked-in snapshot records the generation runtime version, and refreshes require review.

## Boundaries

Table overloads, Text formatting, date/time conversion, broader locale selection, other text
functions, new formula types, and unrelated overload/binder refactoring are excluded. Existing
`emptyTextAsBlank` sites and `IsEmpty` behavior are unchanged. Formula semantics remain browser
native and do not call host casing APIs at evaluation time.

## Evidence

Pinned source files and corpus cases are listed in
`docs/research/scalar-text-probes/README.md`. Reference probes are in
`docs/research/scalar-text-probes/` and replay in both numeric profiles. Exhaustive mapping
verification uses the new `case-map generate` and `case-map verify` reference-harness commands.
Per-case compatibility comparison against the baseline is in
`docs/research/scalar-text-before-after.md`; each profile has zero pass-to-non-pass regressions.
