# Milestone 0016: Scalar text basics

Status: **accepted and implemented; local verification complete, final PR CI pending**. See ADR 0016
and [`scalar-text-before-after.md`](../research/scalar-text-before-after.md).

Baseline: `767321b122080991929dde50382d663dc306ac17` (PR #19 merge). Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`. Profiles: `v1-float` and `v1-decimal`,
PowerFxV1, en-US, UTC.

## Scope and pinned behavior

1. Register and implement scalar `Len`, `Lower`, and `Upper` with exactly one argument.
2. Accept Text, Number, Decimal, Boolean, and Blank. Reuse binder-inserted scalar-to-Text coercions:
   Number/Decimal use the existing invariant backend formatter, Boolean becomes lowercase `"true"`
   or `"false"`, Blank becomes empty Text, and Text is unchanged. Reached Errors pass through.
3. `Len` counts UTF-16 code units and has a profile-specific numeric result type:
   `Len("Power Fx")` is 8, `Len(12345)` is 5, `Len(true)` is 4,
   `Len(Blank())` is 0, and `Len("😀")` is 2. Float mode returns Number; decimal mode returns
   Decimal.
4. `Lower` and `Upper` use the approved frozen en-US simple-case mapping. Examples:
   `Lower("I i İ ı")` is `"i i i ı"`, `Upper("I i İ ı")` is `"I I İ I"`,
   `Lower("ΟΣ ΟΣΑ ΣΟΣ Σ")` uses ordinary sigma rather than contextual final sigma, and
   `Upper("ß")` remains `"ß"` rather than expanding to `"SS"`. Supplementary Deseret case pairs
   map as the reference does; emoji remain unchanged.
5. Record arguments produce both the precise expected-Text type diagnostic and the generic
   invalid-function-arguments diagnostic. Wrong arity uses the existing one-argument diagnostics.
   Table-typed calls are explicitly unsupported in this milestone because their distinct upstream
   table overloads are excluded.

The relevant pinned sources are `StringOneArgFunction.cs`, `Len.cs`, and `LowerUpper.cs` under
`Microsoft.PowerFx.Core/Texl/Builtins`, plus `Microsoft.PowerFx.Interpreter/Functions/LibraryText.cs`.
The corresponding `Len.txt`, `Lower.txt`, and `Upper.txt` corpus files and the probe-generation
commands are documented in `docs/research/scalar-text-probes/README.md`.

The reference casing implementation delegates to .NET `TextInfo`. The upstream pin does not pin
the globalization-data provider; this snapshot was generated on .NET 10.0.14, and the active ICU
provider on that host could not be independently identified. The table is committed and runtime
evaluation does not depend on host casing APIs; regeneration requires explicit review.

## Reused and changed components

- `packages/core/src/functions/signature.ts`: shared signatures, scalar type checks and coercions.
- `packages/core/src/binding/binder.ts`: profile-dependent `Len` type and table-overload unsupported
  classification; precise scalar type diagnostics.
- `packages/interpreter/src/functions/builtins.ts` and `text-case-map.ts`: implementations and
  checked-in simple-case data.
- `packages/interpreter/src/runtime/context.ts` and `evaluator/evaluator.ts`: pass the bound return
  type to builtins so `Len` constructs the correct numeric value.
- `tools/reference-harness/Program.cs`: pinned en-US case-map generation and exhaustive verification.

## Exclusions

Table lifting and table overloads; `Text` formatting; culture-dependent formatting or additional
locales; `Trim`, substring/search/replace, regex and other text functions; Date/Time/DateTime and
new formula types; host casing APIs; generalized overload resolution; and unrelated refactoring.
Existing `emptyTextAsBlank` sites, `IsEmpty`, and other builtin semantics remain unchanged.

## Verification and acceptance

- Generate and replay pre-implementation reference probes in both profiles. Cover scalar coercions,
  Blank/Error behavior, UTF-16 length, diagnostics/arity, Unicode simple casing, supplementary
  characters, and unpaired UTF-16 surrogates.
- Verify the checked-in mapping against en-US `TextInfo` for every Unicode scalar value.
- Run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check`, and both compatibility profiles.
- Compare both candidate per-case reports to baseline `767321b`; explain every verdict transition
  and require zero pass-to-non-pass regressions.
- Update provenance, the coverage inventory, README status, and handoff. Open a draft PR, wait for
  CI on the final pushed commit, and stop for independent review; do not merge or begin another
  milestone.

## Final status

- Implemented: scalar signatures and evaluation; Number/Decimal `Len` results; supported scalar
  coercions; Error propagation; precise record diagnostics; explicitly unsupported table overloads;
  frozen en-US simple-case table.
- Verified: both-profile reference probes; exhaustive mapping verification across all Unicode scalar
  values (678 lowercase and 694 uppercase compressed ranges); `pnpm build`, `pnpm lint`,
  `pnpm format:check`, and all 1,295 tests pass. Both compatibility profiles have zero
  pass-to-non-pass regressions; totals and transitions are recorded in
  [`scalar-text-before-after.md`](../research/scalar-text-before-after.md).
- Unsupported: table overloads and all exclusions above.
- CI: final PR checks are pending. No subsequent milestone is included here.
