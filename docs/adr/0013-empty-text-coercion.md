# ADR 0013: Empty text is Blank in `If` results, table literals and `Table(...)`

Status: provisional (milestone review pending; owner accepted the scope and option B). Pinned upstream
`df4ceba5`. Baseline `main` `f9df8bb`. Spec: `docs/milestones/0013-empty-text-coercion-milestone-spec.md`.

## Context

Upstream coerces `""` to Blank when text is coerced to Number, Decimal or Boolean. We produced `0`/`false`
in `If` results and table construction (25 of 45 probes differed in each profile at `f9df8bb`;
`docs/research/empty-text-probes/`). `Coalesce` already used the `emptyTextAsBlank` flag (ADR 0012).

## Decision: option B

Keep the optional `emptyTextAsBlank` flag on `Coerce` and `Conform` and enable it explicitly at these
binder sites (`packages/core/src/binding/binder.ts`):

1. `If` scalar **result** arguments (`coerce`; conditions are unchanged; `preserveBlank` is kept).
2. `If` aggregate result conformance.
3. Table-literal row conformance, including scalar `Value` wrapping.
4. `Table(...)` (`bindTableCall`), enabled only because focused reference probes for `Table(record, record)`,
   spliced tables and nested table fields (28 expressions, both profiles) show the same rule.

`Conform` is **not** universally empty-text-as-Blank: `conformTo` still defaults to `false`, and
`Coalesce` is unchanged. `coerce()` now applies the flag independently of `preserveBlank` (previously the
flag was only honoured together with `preserveBlank`; `Coalesce` always passed both).

Not changed: `coerceValue`, operators, conditions, `Value`/`Decimal`/`Float`, type unions, diagnostics,
backends, host validation. Text targets keep `""`; typed Blank, missing fields, errors and invalid-text
errors are unchanged. Leaving `coerceValue` alone is a scope decision, not a claim that changing it would
be unobservable (see the spec's correction).

## Evidence

- 45 `If`/array probes, 28 `Table(...)`/nested-table probes and 9 consumer guards replayed in both profiles
  by `packages/engine/test/empty-text.test.ts` (fixtures are verbatim reference output; regenerate with the
  harness `probe` command). Before: 25 + 17 differences; after: none.
- Compat: zero per-case verdict transitions in both profiles. The corpus has no case that exercises this
  difference, so compat gives regression assurance only; the probes are the compatibility evidence.
  Details: `docs/research/empty-text-before-after.md`.
- Runtime safety tests: lazy skipped branches consume no budget; budget and cancellation after evaluation
  starts (scalar, aggregate `If`, table literal, `Table(...)`, nested tables); recursively frozen results,
  error arrays and Decimal payloads.

## Remaining limits

Other places that may retain coerced `""` (e.g. future `Patch`/`Collect`, `ForAll`) are unimplemented; each
must be probed before enabling the flag. `If("",…)`-style condition coercion is unchanged and matched in the
consumer probes.
