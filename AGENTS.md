# Project instructions for coding agents

Browser-native TypeScript implementation of Microsoft Power Fx. Plan: `docs/PowerFx-TypeScript-Plan.md`.

## Start here

1. Read `docs/agent-handoff.md` (current state, source map, gaps).
2. Read only the ADRs and source files relevant to your task (`docs/adr/`); do not load all docs.
3. If `docs/milestones/next.md` is accepted, it defines the scope; otherwise ask.

## Reference and compatibility

- Behavioral reference: Microsoft Power Fx pinned at the commit in `docs/provenance.md`
  (checked out git-ignored under `upstream/Power-Fx`; fetch it at the pin if missing).
- Research upstream source and tests before implementing unfamiliar semantics. Prefer idiomatic
  TypeScript over mechanical C# translation. Keep license notices and provenance current
  (`docs/provenance.md`, `THIRD_PARTY_NOTICES.md`).
- Never hard-code compatibility answers; no tests that merely mirror the implementation. Derive
  expectations from the corpus or from the executable C# reference (`tools/reference-harness`).
- Record the compatibility profile, feature flags, numeric/locale/time-zone assumptions and known
  deviations. Distinguish implemented, verified, unsupported and proposed.

## Architectural invariants

- Core semantics are independent of DOM, Node-specific APIs, Monaco, React, PCF, Dataverse and
  editor protocols. Credentials and network transport stay outside the engine; external operations
  need explicit host capabilities (tests mock or disable them).
- Authoring and evaluation share types, symbols, function signatures, binding and coercion rules.
  Coercions are explicit nodes in the bound tree.
- Formula source, schema/type information and runtime values are separate. Host input is strict;
  no silent coercion of host values.
- Backends: numeric kind (float/decimal) is a backend with identity checks; float stays the
  default unless the owner decides otherwise. Decimal text and inputs must not pass through JS Number.
- Runtime values are recursively frozen (including nested records, error arrays and error objects).
- Lazy evaluation where upstream requires it (`If`, `&&`, `||`, lazy function arguments); evaluation
  budgets and cancellation apply to every evaluated node. Public boundaries stay async-,
  cancellation-, version- and worker-serialization-friendly.
- Compatibility verdicts: `pass`, `fail`, `skip` and `unsupported` are distinct; `invalid` (compile
  diagnostics) is distinct from `unsupported` (not implemented). Report unsupported constructs
  explicitly; never approximate them silently or weaken a verdict to gain a pass.

## Verification (run what the change needs; all must pass before review)

```
pnpm install
pnpm build && pnpm test && pnpm lint && pnpm format:check
pnpm --filter @powerfx-ts/test-suite compat v1-float
pnpm --filter @powerfx-ts/test-suite compat v1-decimal
```

- Compat runs write per-case `packages/test-suite/reports/<profile>.engine.cases.tsv` (git-ignored)
  and committed `.md` reports. Compare per-case verdicts against the merged baseline: zero
  pass-to-non-pass regressions; report fixes and regressions separately.
- The reference harness needs .NET (`tools/reference-harness`, usage is printed by Program.cs).
- Documentation-only changes need only formatting (`pnpm format:check`) and link/path checks.

## Workflow

- Small vertical slices, one bounded milestone per branch and draft PR. Add an ADR for design
  decisions and a before/after evidence note for compatibility changes.
- Work only in your assigned working tree; preserve unrelated changes; never touch another clone.
- Do not merge, publish, deploy or run destructive Git operations unless explicitly instructed.
  Every milestone gets independent review, passing CI on the final commit, and owner acceptance
  before merge. Do not start the next milestone unasked.
- Commits carry the trailer `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`.
- Final report: delivered, checks, decisions needing review, limitations, manual steps, next step.
