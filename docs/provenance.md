# Provenance register

Every file or test corpus derived from Microsoft Power Fx is recorded here.

**Pinned upstream commit:** `df4ceba5e08220db670c25afead342ce699c50b5` (2026-10-02)

No upstream code has been copied. Diagnostic message templates PFX2001–PFX2006 reuse the English
wording of upstream `src/strings/PowerFxResources.en-US.resx` (MIT, Copyright Microsoft Corporation)
so compile-error expectations match; the binder, evaluator and number formatting are original,
informed by corpus behavior and `BaseRunner.cs`. The test-suite reader (`packages/test-suite/src/txt-format.ts`,
`profile.ts`, `runner.ts`) is an original implementation of the upstream `.txt` format and applicability
rules, informed by `TestRunner.cs` and `BaseRunner.cs`.

| Our path | Upstream path | Upstream commit | Reuse kind (algorithm / test / data) | Notes |
| -------- | ------------- | --------------- | ------------------------------------ | ----- |
