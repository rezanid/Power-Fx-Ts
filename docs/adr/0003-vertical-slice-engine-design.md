# ADR 0003: Vertical-slice engine design

Status: accepted (slice milestone)

- **Bound tree is the IR.** The binder (`core`) turns the parse tree into a typed `BoundNode` tree
  with explicit `Coerce` nodes, so the evaluator never re-derives typing rules. Function signatures
  (`core/functions`) are shared by binder and interpreter; a test asserts every signature has an
  implementation.
- **Unsupported is not an error.** Unknown functions, records, tables, chaining etc. are recorded as
  `unsupported` features; the compat runner reports them as `unsupported`, never pass or fail.
- **Numerics behind `NumericBackend`.** Values hold opaque `NumericValue`s; only the float backend
  exists. `v1-decimal` is reported unsupported until a decimal backend lands.
- **Runtime errors are values** (`Div0`, `InvalidArgument`, `Numeric`); compile errors are
  diagnostics with upstream wording and UTF-16 half-open spans.
- **Async/cancellation boundary.** `Engine.evaluate` is async; a structural `CancellationSignal`
  (no DOM types) and a `maxSteps` budget are checked per node. Core and interpreter use no DOM or
  Node APIs and no ambient I/O.
- **Known deviations:** text comparison uses `Intl.Collator`; binary operators return the first
  error instead of merging; ordering-operator diagnostics follow an empirically derived matrix.
