# ADR 0001: Monorepo, tooling and package boundaries

Status: Accepted (provisional package names)

- pnpm workspaces; TypeScript project references (`tsc -b`); ESM only; Vitest; ESLint; Prettier.
- Scope `@powerfx-ts/*` is a placeholder pending trademark review (plan section 18).
- Packages: `core`, `interpreter`, `engine`, `language-service`, `serialization`, `test-runner`,
  `test-suite` (private). Later: `monaco`, `react-editor`, `worker`, `lsp`, `integrations/pcf`,
  `connectors`, `gateway`.
- Dependency direction: core ← interpreter ← engine ← language-service / test-runner.
  `core` and `interpreter` must not use DOM or Node APIs (enforced via ESLint).
- The layout is inspired by upstream Power Fx but follows TypeScript conventions; it is not a
  class-for-class or folder-for-folder mirror. Monaco is the first UI target.
- Source offsets are UTF-16, half-open spans.
