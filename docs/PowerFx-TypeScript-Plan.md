# Power Fx TypeScript Implementation — Project Plan and Architecture

**Status:** Concept / feasibility plan  
**Original date:** 6 October 2026  
**Revised:** 9 October 2026

**Revision note:** All original topics and phases are preserved. Sections 23–29 incorporate the latest architecture and repository research; they govern where earlier illustrative layouts or APIs differ. “Decision” means a commitment of this plan, not implemented functionality. “Future consideration” means deferred or unresolved work. Package names and API sketches remain provisional.

## 1. Executive summary

Build an open-source, browser-native TypeScript implementation compatible with Microsoft's Power Fx language. The project should use the official C# Power Fx implementation as the behavioral reference and its extensive test corpus as a compatibility specification, while producing an idiomatic TypeScript architecture rather than a mechanical class-for-class translation.

The initial product should focus on the language itself: parsing, syntax trees, diagnostics, binding and type inference, intermediate representation, values, evaluation, symbols, dependency tracking, and built-in functions. Editor-independent service contracts, incomplete-expression recovery, schema/value separation, cancellation and worker compatibility are foundational commitments. Full IntelliSense, signature help, semantic information, Monaco/React components, PCF and an LSP adapter follow once the core is stable.

Connectors are deliberately deferred, but remain an important later capability. They should project OpenAPI operations and schemas into typed Power Fx functions while keeping authentication, secrets and network topology outside the language engine. Direct browser invocation, API gateways such as Azure API Management, and an optional open-source gateway can all satisfy the same transport abstraction.

The resulting project has value well beyond Power Platform: it can serve as a safe, strongly typed, sandboxed expression and automation engine for React/browser/Node applications, configurable SaaS products, form and workflow designers, rules engines, and AI-generated business logic.

## 2. Core decisions

1. **Use TypeScript, not plain JavaScript.** The language implementation itself benefits heavily from static types, discriminated unions, generics, exhaustiveness checks and strong tooling. JavaScript consumers can still use the compiled packages.
2. **Compatibility is behavioral, not architectural.** Power Fx C# defines the behavior; the TypeScript implementation does not need to reproduce every historical C# abstraction or class hierarchy.
3. **Do not mechanically translate the repository.** Study and reuse proven algorithms where appropriate, but design idiomatic TypeScript APIs and internals.
4. **Treat Microsoft's tests as an executable specification.** Build a TypeScript runner capable of consuming the existing expression-test format wherever practical.
5. **Build the language before connectors.** Core semantics and the binder/type system are the difficult and strategically important parts.
6. **Keep connectors transport- and authentication-agnostic.** The Power Fx engine must never need to own credentials.
7. **Make browser-native execution a first-class goal.** Parsing, binding, diagnostics, IntelliSense and ordinary evaluation should require no backend.
8. **Do not require Azure.** Azure APIM can be an excellent production option, but the library must remain cloud-neutral.
9. **Eventually provide an optional open-source gateway.** It should make secure connector execution easy for users who do not already have suitable API-management infrastructure.
10. **Position the project beyond Power Platform.** It is an embeddable typed expression/automation platform that happens to be compatible with Power Fx, not merely a Power Platform utility.

## 3. Why this project is feasible

Power Fx already has the ingredients that make an AI-assisted reimplementation unusually practical:

- an open-source C# reference implementation;
- a modular architecture separating core language concerns, interpretation, connectors and authoring-related capabilities;
- a mature suite of expression and unit tests;
- explicit language types and values rather than arbitrary CLR execution;
- years of production language-design work already embodied in the implementation and tests; and
- an MIT license suitable for modification, redistribution and commercial use, subject to its notice requirements.

AI does not need to invent the language. An agent can inspect a bounded area of the C# implementation, inspect the associated tests, implement the equivalent TypeScript behavior, run compatibility tests, fix failures, and repeat.

## 4. Target architecture

The conceptual language pipeline is:

```text
Power Fx source
      │
      ▼
 Lexer / tokenizer
      │
      ▼
 Parser
      │
      ▼
 Syntax tree
      │
      ▼
 Binder / type checker
      │
      ▼
 Intermediate representation
      │
      ▼
 Evaluator
      │
      ▼
 FormulaValue
```

A possible package layout:

```text
packages/
  core/
    lexer/
    parser/
    syntax/
    types/
    binding/
    ir/
    functions/
    diagnostics/

  interpreter/
    evaluator/
    values/
    functions/
    runtime/

  engine/
    symbols/
    recalc/
    dependencies/

  language-service/       # editor-independent authoring
    completion/
    signature-help/
    semantic-info/

  monaco/                 # direct service adapter
  react-editor/           # reusable editor and test UI
  test-runner/            # headless expression testing
  worker/                 # optional execution adapter

  lsp/                    # parallel protocol adapter
    server/

  connectors/              # later
    openapi/
    projection/
    runtime/
    transport/

  test-suite/
    microsoft-compat/
    unit/
    integration/

  gateway/                 # optional, much later
```

The exact package boundaries should remain flexible until implementation exposes the most natural dependency graph.

## 5. Public API philosophy

The API should feel native to TypeScript rather than exposing C# history.

Illustrative usage:

```ts
const engine = new PowerFxEngine();

const result = await engine.evaluate(`If(Order.Total > 10000, "Approval", "Automatic")`, { Order });
```

Checking should be available independently of evaluation:

```ts
const check = engine.check(`Filter(Accounts, Revenue > 1000000)`);

console.log(check.returnType);
console.log(check.diagnostics);
```

The implementation should expose clean concepts such as `Parser`, `SyntaxNode`, `Binder`, `FormulaType`, `FormulaValue`, `SymbolTable`, `Function`, `Diagnostic`, and `Evaluator` rather than preserving old internal naming merely for fidelity.

## 6. The hardest engineering area: binder and type system

The parser and built-in functions are substantial but comparatively straightforward. The binder/type system is expected to be the hardest component.

For an expression such as:

```powerfx
Filter(Accounts, Revenue > 100000)
```

the engine must understand that `Accounts` is a table, establish row scope, resolve `Revenue` within that scope, select the correct `Filter` overload, apply coercion rules, infer the result type, generate diagnostics and produce an executable representation.

Areas requiring particular care include:

- overload resolution;
- coercion;
- records and tables;
- row/lambda scopes;
- option sets/enums;
- blank and error semantics;
- untyped objects;
- dates, times and locale behavior;
- behavior functions and mutation;
- symbol resolution;
- delegation-related metadata where applicable; and
- compatibility quirks accumulated by the real language.

This is precisely where the reference implementation and compatibility tests provide the greatest value.

## 7. Test and compatibility strategy

Tests should be designed before or alongside implementation. The most valuable goal is a harness capable of consuming Microsoft's existing expression-test cases directly or with minimal conversion.

Conceptually:

```text
Microsoft expression test cases
              │
              ▼
       TypeScript test runner
              │
              ▼
       TypeScript Power Fx
              │
              ▼
     actual vs expected result
```

Compatibility should be measurable. Maintain a dashboard or generated report showing, by language area:

- total applicable upstream cases;
- passing cases;
- intentionally unsupported cases;
- known semantic deviations; and
- regressions.

Tests should cover parsing and diagnostics as well as successful evaluation. Negative tests are especially important for the binder.

When upstream tests rely on C#-specific test infrastructure, translate the test's behavioral intent rather than its implementation mechanism.

## 8. AI-assisted implementation workflow

A repeatable unit of work can be:

```text
1. Select a bounded Power Fx feature.
2. Identify its C# implementation and dependencies.
3. Identify all relevant upstream tests.
4. Port/adapt the tests or make them consumable by the TS harness.
5. Implement the feature idiomatically in TypeScript.
6. Run compatibility + local tests.
7. Investigate semantic differences against the C# implementation.
8. Fix and refactor.
9. Record unsupported behavior explicitly.
```

AI agents are particularly suitable because the reference source and tests sharply constrain the desired behavior. However, compatibility tests remain the authority; generated code should never be accepted simply because it resembles the C# implementation.

## 9. Phased implementation plan

### Phase 0 — repository, provenance and compatibility infrastructure

Establish licensing/provenance rules, TypeScript monorepo tooling, CI, formatting/linting, test framework, upstream test ingestion, and a compatibility-report mechanism.

Before bulk reuse, audit the upstream repository for vendored/generated assets, third-party files and files with distinct notices.

### Phase 1 — language foundation

Implement:

- source spans and diagnostics, including incomplete-expression recovery;
- lexer/tokenizer;
- parser;
- AST/syntax model;
- primitive formula types;
- records and tables at a foundational level;
- symbols and scopes;
- initial binder/type checking;
- FormulaValue hierarchy;
- evaluator/interpreter;
- core operators; and
- a useful initial set of built-in functions.

The milestone is not percentage parity; it is a coherent end-to-end engine capable of parsing, checking and evaluating useful expressions.

### Phase 2 — serious language compatibility

Expand into:

- richer type inference;
- complete coercion behavior;
- lambdas and row scopes;
- record/table functions;
- dates/times;
- blank/error behavior;
- option sets and related types;
- untyped objects;
- behavior functions where in scope;
- broader built-in function coverage;
- locale-sensitive behavior; and
- dependency/recalculation semantics.

Compatibility metrics should become a release criterion during this phase.

### Phase 3 — authoring platform

Implement browser-native authoring capabilities:

- `check()` and diagnostics;
- completion/IntelliSense;
- signature help;
- hover/semantic information;
- syntax/semantic token support where useful;
- formatting if justified; and
- direct Monaco integration and a reusable React editor;
- a reusable headless expression test runner and test dialog; and
- Language Server Protocol adapter support informed by upstream code/tests.

A key target is excellent integration with Monaco and other editors without a server round trip for ordinary authoring operations.

### Phase 4 — connectors

Only after the language core is mature, add OpenAPI-to-Power-Fx projection and connector invocation abstractions. Start with ordinary OpenAPI before pursuing broad Power Platform connector compatibility.

### Phase 5 — optional secure gateway and deployment recipes

Provide an optional open-source gateway plus documented recipes for Azure APIM and other cloud/API-management solutions.

## 10. Browser-native authoring: major advantage

A browser implementation enables an editor to perform locally:

- tokenization and parsing;
- binding/type inference;
- diagnostics;
- completion;
- signature help;
- semantic information; and
- pure/local formula evaluation.

For a Monaco-based editor:

```text
Monaco / application UI
          │
          ▼
      Power Fx TS
   ┌─────────────────┐
   │ Parser          │
   │ Binder          │
   │ Type system     │
   │ Diagnostics     │
   │ IntelliSense    │
   │ Interpreter     │
   └─────────────────┘
```

This avoids a backend dependency for the majority of the development experience and enables offline or low-latency scenarios.

## 11. Connectors: added value

Connector support changes the proposition from a typed expression engine toward an embeddable low-code/automation runtime.

The central idea is to project an OpenAPI definition into:

- a Power Fx namespace;
- strongly typed functions;
- required and optional parameters;
- request/response types;
- IntelliSense/signature metadata; and
- a runtime invocation description.

Example:

```powerfx
GitHub.GetIssue("microsoft", "Power-Fx", 123)
```

The binder can understand this expression entirely locally if the OpenAPI description has already been loaded. It can know the function, parameters and response shape without performing a network call.

OpenAPI therefore drives both **authoring** and **execution**:

```text
                 OpenAPI
                    │
                    ▼
          Connector projection
             ┌──────┴──────┐
             ▼             ▼
        functions        types
             └──────┬──────┘
                    ▼
             Binder / LSP
                    │
                    ▼
              IntelliSense
                    │
                    ▼
                 runtime
```

## 12. Connector scope: what not to build initially

Do not attempt to reproduce the entire Power Platform connector infrastructure.

The first connector implementation should focus on standard OpenAPI concepts such as:

- operation IDs;
- HTTP methods and paths;
- parameters;
- request bodies;
- response schemas;
- objects and arrays;
- enums;
- required/optional fields; and
- serialization/deserialization.

Power Platform-specific `x-ms-*` extensions can be added incrementally where they provide clear compatibility or authoring value, for example summaries, visibility, enums, pagination, dynamic values and dynamic schemas.

Connection management, consent infrastructure, secret storage and cloud-specific policy systems are **not** responsibilities of the language engine.

## 13. Connector security and transport architecture

The engine should never own credentials. Define a narrow transport boundary, for example:

```ts
interface ConnectorTransport {
  invoke(request: ConnectorRequest): Promise<ConnectorResponse>;
}
```

The same connector function can then execute through different transports:

```text
                  Power Fx
                     │
              ConnectorFunction
                     │
              ConnectorTransport
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
 Direct browser   API gateway   OSS gateway
       │             │             │
       └─────────────┼─────────────┘
                     ▼
                    API
```

This keeps parsing, binding and connector semantics independent of deployment topology.

### Direct browser transport

Use direct `fetch()` where the target API supports appropriate CORS and browser-safe authentication such as OAuth authorization code + PKCE. The host application supplies tokens/authentication integration rather than Power Fx storing secrets.

### API-management transport

For enterprise deployments, API management can provide the secure server-side boundary without requiring a custom application server.

Azure API Management is especially relevant because it can authenticate callers, use managed identities for supported backends, and use Credential Manager for OAuth connection/token lifecycle scenarios. The browser can therefore call APIM while APIM handles backend credentials and token injection.

The Power Fx library should see APIM as ordinary HTTP; an Azure-specific runtime dependency may not be necessary.

### AWS and other clouds

Document equivalent deployment patterns, but do not assume every API gateway provides exactly the same OAuth credential-broker functionality as Azure APIM. Where native infrastructure is insufficient, the optional OSS gateway fills the gap.

## 14. Optional open-source Power Fx gateway

A later companion project can make secure connector execution easy for users without suitable existing infrastructure.

Conceptually:

```text
Browser / Node client
        │
        ▼
   Power Fx gateway
   ├─ authentication
   ├─ token acquisition/refresh
   ├─ secret integration
   ├─ connector allow-list
   ├─ request forwarding
   └─ policy/limits
        │
        ▼
      target API
```

It should be deployable as a small container rather than requiring developers to write server code themselves.

Possible deployment targets include Docker, Kubernetes, Azure Container Apps, App Service, AWS container/serverless environments and other container hosts.

The gateway is optional. Recommended deployment choices become:

```text
1. Direct browser invocation       — when safe and supported
2. Existing API gateway            — preferred enterprise option
3. OSS Power Fx gateway            — portable turnkey option
4. Custom ConnectorTransport       — full host control
```

## 15. Value outside Power Platform

This is a major project objective, not a side effect.

### 15.1 Configurable business rules

Ordinary web/SaaS applications frequently need user-configurable rules:

```powerfx
Order.Total > 10000 && Customer.Country = "BE"
```

Instead of inventing a proprietary DSL, storing arbitrary JavaScript, or constructing verbose JSON rule trees, an application can embed a mature expression language with a real parser and type system.

### 15.2 Safe user-authored logic

Power Fx can provide a constrained execution environment. The host decides which symbols and functions exist; expressions do not automatically gain access to `window`, `document`, Node APIs, files, process state or arbitrary JavaScript execution.

This makes it attractive for multi-tenant SaaS products that need customer-defined calculations or business logic.

### 15.3 Form and questionnaire engines

Dynamic visibility, validation, calculations and branching can use readable formulas rather than a custom condition schema:

```powerfx
Country = "Belgium" && Age >= 18
```

With a supplied schema/symbol table, users can receive compile-time diagnostics and IntelliSense for their application's own fields.

### 15.4 Low-code builders and workflow designers

React-based application builders can use Power Fx for properties such as visibility, calculated values, filters, validation and actions. Connector support later allows those formulas to invoke APIs.

### 15.5 Reactive calculations and dependency tracking

Power Fx's calculation model can support dependency-aware applications:

```text
Quantity ──► Total ──► Tax ──► Final
                 └────────────► Final
```

This is useful for pricing engines, financial calculators, configuration tools, forms, dashboards and spreadsheet-like experiences.

### 15.6 AI-generated business logic

A constrained typed language is an attractive target for LLM-generated logic:

```text
User request
    │
    ▼
   LLM
    │
    ▼
Power Fx expression
    │
    ▼
Parser + Binder
    │
    ├── diagnostics ──► repair loop
    │
    ▼
Evaluator
```

The deterministic binder/type checker becomes a validation boundary between probabilistic generation and execution. This is considerably safer and more inspectable than asking an LLM to generate arbitrary JavaScript for many business-rule scenarios.

## 16. Product positioning

Avoid positioning the project merely as “Power Fx for JavaScript.” That framing unnecessarily limits the audience to people already familiar with Power Platform.

A stronger proposition is:

> **A safe, strongly typed expression and automation engine for JavaScript and TypeScript applications, compatible with Microsoft Power Fx.**

Potential audiences include:

- Power Platform developers who need Power Fx outside Microsoft's runtime;
- React and web developers;
- SaaS vendors needing configurable business logic;
- form/workflow/application-builder vendors;
- rules-engine users;
- Node developers; and
- AI-enabled products that need constrained generated logic.

Connectors strengthen the proposition further by moving from an expression engine toward an embeddable low-code runtime.

## 17. Licensing

The official Microsoft Power Fx repository is released under the MIT License. At a high level, MIT permits use, copying, modification, distribution, sublicensing and commercial use, subject principally to preserving the applicable copyright and license notice.

This makes the proposed activities feasible, including:

- studying the C# implementation;
- porting or adapting algorithms to TypeScript;
- modifying architecture;
- reusing/adapting appropriately licensed tests;
- distributing packages through npm;
- embedding the result in commercial software; and
- building additional original packages such as connector transports or a gateway.

### Required due diligence

Before substantial source/test reuse, perform a repository-level provenance audit rather than relying only on the root license. Identify:

- vendored third-party code;
- generated files;
- assets/test data with separate terms;
- files with distinct copyright notices; and
- dependencies whose licenses affect redistribution.

Maintain clear third-party notices and provenance for Microsoft-derived material.

This document is an engineering plan, not legal advice; final public/commercial distribution should use normal license-review practices.

## 18. Branding and trademark considerations

The MIT software license does not itself grant Microsoft trademark rights. The project should avoid names, logos or presentation that imply Microsoft sponsorship or that the project is an official Microsoft distribution.

Prefer an independent project/product name with wording such as:

> A TypeScript implementation compatible with Microsoft Power Fx.

Avoid branding such as “Microsoft Power Fx TypeScript.” Whether `PowerFx` should appear in the project/package name should be reviewed against Microsoft's then-current trademark guidance before launch.

The independent brand can coexist with very explicit compatibility documentation.

## 19. What we deliberately are not committing to

At this stage the project is **not** committing to:

- immediate 100% compatibility;
- implementing connectors in the initial releases;
- reproducing Microsoft's internal class structure;
- recreating Power Platform's entire connection infrastructure;
- Azure as a required dependency;
- executing arbitrary JavaScript extensions;
- supporting every `x-ms-*` connector extension initially; or
- reproducing every Power Apps product behavior that is not fundamentally part of the Power Fx language/runtime.

Unsupported behavior should be explicit and measurable rather than hidden behind best-effort semantics.

## 20. Success criteria

Early success means:

1. useful formulas parse, bind and evaluate entirely in TypeScript;
2. compatibility can be objectively measured against upstream tests;
3. diagnostics and types are reliable enough for editor integration;
4. the engine works in modern browsers and Node without .NET;
5. the public API is idiomatic for TypeScript developers; and
6. unsupported Power Fx behavior is documented.

Longer-term success means:

1. broad Power Fx semantic compatibility;
2. first-class Monaco/LSP authoring;
3. robust OpenAPI connector projection;
4. secure, pluggable connector transports;
5. easy production deployment through API gateways or the optional OSS gateway; and
6. meaningful adoption by projects that have no dependency on Power Platform.

## 21. Recommended immediate next steps

The next work should remain intentionally narrow:

1. Audit the upstream repository's current package/project structure and licensing/provenance boundaries.
2. Inventory the expression-test infrastructure and determine how much can be consumed unchanged.
3. Map the minimum dependency graph for lexer → parser → AST → binder → evaluator.
4. Define TypeScript runtime targets (browser/Node and module formats) and monorepo tooling.
5. Prototype the compatibility runner before doing a broad port.
6. Implement one vertical slice end-to-end—for example literals, identifiers, arithmetic/comparison, `If`, primitive types, binding and evaluation.
7. Use that slice to validate the proposed architecture and AI-assisted workflow before scaling implementation.

The project should resist the temptation to begin by porting hundreds of files. A small, tested vertical slice will tell us whether the package boundaries, value model, diagnostics, test harness and coding-agent workflow are correct.

## 22. Long-term vision

The ultimate architecture can be summarized as:

```text
                 Applications / Editors / AI
                           │
                           ▼
                    TypeScript API
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
      Authoring         Language         Runtime
   diagnostics/LSP   parser+binder    interpreter
          │                │                │
          └────────────────┼────────────────┘
                           │
                    Formula model
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
          Local functions        Connectors
                                      │
                              ConnectorTransport
                                      │
                     ┌────────────────┼───────────────┐
                     ▼                ▼               ▼
                 Browser           APIM/API       OSS gateway
                  direct           gateway
                     └────────────────┼───────────────┘
                                      ▼
                                   APIs
```

The initial reason to build the project is straightforward: make the Power Fx language natively available to the TypeScript/browser ecosystem.

The larger opportunity is more ambitious: provide web and SaaS developers with a mature, safe, typed, authorable and eventually API-aware expression/automation language without requiring Power Platform or .NET.

## 23. Repository research findings and continuing research plan

**Research snapshot:** 9 October 2026. The repository directories and selected source files below were inspected through GitHub. This is a targeted architecture review, not a full source audit or a guarantee of latest-release behavior. Browsed pages can be cached, and the inspected main-branch files were not pinned to one commit. Phase 0 must establish that reproducible baseline before implementation.

### 23.1 Existing components we should study

| Upstream area                 | Observed responsibility                                                 | TypeScript design implication                                                       |
| ----------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Core                          | Lexer, parser, syntax, binding, types, IR, public APIs and IntelliSense | Preserve semantic behavior; separate reusable services from editor adapters         |
| Interpreter                   | Evaluation, built-in implementations, runtime values and recalculation  | Keep signatures shared with authoring and implementations in runtime                |
| LanguageServerProtocol        | Existing C# language-server implementation                              | Study and adapt contracts/tests; do not invent the integration without reviewing it |
| Json                          | Separate JSON integration                                               | Define explicit type/value codecs and marshalling boundaries                        |
| Connectors                    | Separate connector library                                              | Retain deferred connector phase and transport independence                          |
| Repl and Transport.Attributes | Additional libraries present in the tree                                | Inventory their relevance; neither automatically becomes an initial TS package      |

These areas are visible in the [upstream libraries directory](https://github.com/microsoft/Power-Fx/tree/main/src/libraries). The [Core tree](https://github.com/microsoft/Power-Fx/tree/main/src/libraries/Microsoft.PowerFx.Core) contains the language pipeline and public surface. Our boundaries are a design interpretation of this evidence, not a promise to reproduce the project structure.

### 23.2 The repository already has an LSP implementation

The [LanguageServerProtocol library](https://github.com/microsoft/Power-Fx/tree/main/src/libraries/Microsoft.PowerFx.LanguageServerProtocol) is real existing C# functionality. Its [default handler factory](https://github.com/microsoft/Power-Fx/blob/main/src/libraries/Microsoft.PowerFx.LanguageServerProtocol/Handlers/Factories/DefaultLanguageServerOperationHandlerFactory.cs) dispatches completion, signature help, full/range semantic tokens, code actions, document open/change and custom operations. The inspected [LanguageServer implementation](https://github.com/microsoft/Power-Fx/blob/main/src/libraries/Microsoft.PowerFx.LanguageServerProtocol/LanguageServer/LanguageServer.cs) exposes asynchronous request processing with cancellation tokens and retains an obsolete synchronous entry point.

The [EditorContextScope](https://github.com/microsoft/Power-Fx/blob/main/src/libraries/Microsoft.PowerFx.LanguageServerProtocol/Public/EditorContextScope.cs) connects authoring to engine checks and suggestions. The [LSP test directory](https://github.com/microsoft/Power-Fx/tree/main/src/tests/Microsoft.PowerFx.Interpreter.Tests.Shared/LanguageServiceProtocol) includes protocol, position/range, semantic-token and redesigned-server tests.

**Decision:** Research this implementation as part of our authoring design. Map each required operation to a shared TypeScript service and then to an LSP adapter. Monaco uses those services directly and does not require an LSP server or backend. C# code cannot simply run in a browser-native TypeScript library; a remote .NET service would be a separate hosting option.

**Future considerations:** Standard LSP coverage, JSON-RPC transports and Power Fx custom extensions. Inventory initialization, synchronization, shutdown and cancellation behavior before advertising compatibility. The presence of handlers does not establish full standard LSP compliance. Hover, formatting, rename and navigation require separate verification/design; natural-language custom handlers are optional future extensions.

### 23.3 Context, compilation and tests

The [Core configuration directory](https://github.com/microsoft/Power-Fx/tree/main/src/libraries/Microsoft.PowerFx.Core/Public/Config) includes deferred/composed symbol tables, feature configuration and version hashes. The inspected [CheckResult](https://github.com/microsoft/Power-Fx/blob/main/src/libraries/Microsoft.PowerFx.Core/Public/CheckResult.cs) retains compilation inputs, binding information and staged results. [IntellisenseOperations](https://github.com/microsoft/Power-Fx/blob/main/src/libraries/Microsoft.PowerFx.Core/Public/IntellisenseOperations.cs) uses the existing binding to validate function invocations and identify row-scoped arguments. These support our decision to share semantics and use consistent context snapshots; they do not establish an upstream asynchronous metadata API equivalent to our proposed provider.

The [Core shared tests](https://github.com/microsoft/Power-Fx/tree/main/src/tests/Microsoft.PowerFx.Core.Tests.Shared) cover parsing, binding, types, symbols, IntelliSense and user-defined constructs. Its [expression corpus](https://github.com/microsoft/Power-Fx/tree/main/src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases) includes decimal/float, feature-profile and timezone variants. [Interpreter shared tests](https://github.com/microsoft/Power-Fx/tree/main/src/tests/Microsoft.PowerFx.Interpreter.Tests.Shared) add runtime, recalculation, mutation and async behavior.

**Decision:** Compatibility reports identify upstream commit, feature profile, numeric mode, culture/timezone, fixtures and applicable cases. A passing percentage without these inputs is insufficient. Investigate decimal representation and arithmetic before defaulting all Power Fx numbers to JavaScript Number. Record unsupported UDF/UDT, delegation and mutation behavior explicitly instead of assuming the initial vertical slice covers them.

### 23.4 Research and component design are implementation work

Before each bounded feature is implemented:

1. Pin the upstream commit and identify relevant files, tests and configuration flags.
2. Trace dependencies and distinguish language semantics from host/product integration.
3. Write a C# responsibility → TypeScript component map, recording reuse/adaptation and provenance.
4. Specify public/internal contracts, failure behavior, serialization and cancellation needs.
5. Review the design against browser, Node, worker, Monaco and future PCF consumers.
6. Implement a vertical slice and differential/compatibility tests, then record deviations.

Phase 0 outputs include the source/test inventory, compatibility profile, provenance register, dependency diagram and architecture decision records. Research should also inspect [official host samples](https://github.com/microsoft/power-fx-host-samples) and selected Monaco releases. Source inspection is continuing work, not a one-time exercise before a bulk translation.

## 24. Revised component architecture and foundational decisions

**Decision:** The engine knows nothing about Monaco, React, PCF, Dataverse or editor protocols. Adapters depend on shared services; core never depends on adapters. Core and interpreter avoid DOM and Node-specific APIs.

    PCF wrapper / ordinary React application
                      |
                React editor + test dialog
                      |
                Monaco adapter       LSP adapter
                      \______________/
                              |
                      Language service
                              |
                Core: syntax, types, binder, IR
                              |
                 Interpreter / recalc engine
                              |
               Values + granted host capabilities

Logical package boundaries replace the earlier intellisense-only layout:

| Component        | Responsibility                                                                             | Delivery                                |
| ---------------- | ------------------------------------------------------------------------------------------ | --------------------------------------- |
| core             | Recoverable parser, spans, types, symbols, function signatures, binder, IR and diagnostics | Phase 1–2                               |
| interpreter      | Values, evaluator, built-in implementations, async host calls and budgets                  | Phase 1–2                               |
| engine           | Convenient compilation/evaluation API, dependency analysis and recalculation               | Phase 1–2                               |
| language-service | Checks, completion, signatures, hover and semantic information                             | Contracts early; full features Phase 3  |
| context          | Static snapshots and extensible symbol/metadata resolution                                 | May initially live within core/service  |
| serialization    | Versioned schema/type/value DTOs and JSON conversion                                       | Basic boundary codec early              |
| worker           | Request IDs, versioned messages, cancellation bridge and provider RPC                      | Compatibility early; execution optional |
| monaco           | Power Fx registration and editor-neutral service mapping                                   | Phase 3                                 |
| react-editor     | Controlled expression editor and reusable testing UI composition                           | Phase 3                                 |
| test-runner      | Headless test sessions, fixtures, mocks and expected results                               | Independent of UI                       |
| integrations/pcf | Dataverse field binding and supported PCF lifecycle/context                                | Hosting experiment early; product later |
| integrations/lsp | Protocol mapping, lifecycle, transport and advertised capabilities                         | Phase 3                                 |
| connectors       | OpenAPI projection and typed operation descriptors                                         | Phase 4                                 |
| test-suite       | Upstream compatibility runner and local/integration verification                           | Phase 0 onward                          |
| gateway          | Optional trusted server-side identity, policy and forwarding                               | Phase 5                                 |

These are logical boundaries; publishing a package for every row is unnecessary initially. React and Monaco must not become transitive dependencies of headless core packages. The reusable React editor can use React as a peer dependency to accommodate hosts. UI-specific testing may initially live in react-editor while the runner remains headless.

**Decision:** Authoring and evaluation share the binder, type model, function identities, overload rules and coercion behavior. Signatures/documentation live in the shared semantic layer, runtime implementations behind the evaluator. Avoid a second IntelliSense type checker.

**Future considerations:** Exact package names, module formats, supported runtime versions, release/versioning strategy and LSP transports. Choose these after prototypes and consumer requirements are known.

## 25. Language services, schema separation and context providers

### 25.1 Editor-neutral authoring

**Decision:** Service results use editor-neutral diagnostics, ranges, completion descriptions and signatures. Monaco and LSP map those results into their own types. TypeScript enables tooling implementation; Monaco's TypeScript language service does not understand Power Fx automatically.

The parser must tolerate incomplete formulas such as Filter(Accounts, Revenue >), preserving partial syntax and useful source spans. Decide recovery behavior from the start; full incremental parsing can wait.

Illustrative contract shape; all referenced types require separate definition:

    interface DocumentSnapshot {
      id: string;
      version: number;
      text: string;
    }
    interface ServiceRequest {
      document: DocumentSnapshot;
      contextId: string;
      contextVersion: string;
      locale: string;
      compatibilityProfile: string;
      signal?: AbortSignal; // local API, not a worker wire field
    }
    interface PowerFxLanguageService {
      parse(text: string, options: ParseOptions): ParseResult;
      check(request: ServiceRequest): Promise<CheckSummary>;
      complete(request: ServiceRequest, offset: number): Promise<CompletionResult>;
      signatureHelp(request: ServiceRequest, offset: number): Promise<SignatureResult>;
      hover(request: ServiceRequest, offset: number): Promise<HoverResult>;
    }

**Decision:** Document offsets use UTF-16 with documented half-open spans. Adapters translate line/column conventions. Verify CRLF, multiline and non-BMP text. Diagnostics have stable codes independent of localized messages. Compilation explicitly receives culture, compatibility flags and expected result type.

Checking does not evaluate formulas. Cache compiled semantic snapshots by expression/document revision, context/schema revision, function registry, culture, profile and authoring policy. A snapshot can serve checking, authoring and execution where valid. The earlier check() sketch is shorthand; checking against Accounts requires an Accounts schema. Async orchestration may wrap synchronous parsing/binding against a resolved snapshot.

**Future considerations:** Formatting, quick fixes, rename/navigation and incremental parsing. Interface availability is not feature completion.

### 25.2 Expression, schema and values

**Decision:** Keep three separate inputs:

| Input      | Purpose                                          | Consumers                     |
| ---------- | ------------------------------------------------ | ----------------------------- |
| Expression | Persisted formula source                         | Parser, binder, editor        |
| Schema     | Available variables/types/functions and metadata | Binder, IntelliSense, test UI |
| Values     | Concrete inputs for one execution                | Evaluator and test runner     |

A schema can declare Customer.RiskScore as Number without loading a customer record. The formula If(Customer.RiskScore > 80, "High", "Normal") can then be checked; a test supplies a value of 75 separately.

Define a versioned Power Fx schema representation and optional JSON Schema adapters. Simplified JSON examples are not a complete type specification. Decide mappings for absent fields, blank, null, errors, decimal/float, date/time, tables, choices and untyped values. Validate runtime values against the same schema revision used for checking. JavaScript-object marshalling must not expose arbitrary methods/prototypes to formulas.

### 25.3 Lazy and asynchronous context

**Decision:** Static snapshots are the initial provider. Contracts allow paged discovery and lazy metadata resolution later:

    interface FormulaContextProvider {
      getSnapshot(signal?: AbortSignal): Promise<SchemaSnapshot>;
      listSymbols(query: SymbolQuery, signal?: AbortSignal): Promise<SymbolPage>;
      resolveSymbol(id: string, signal?: AbortSignal):
        Promise<SymbolDescriptor | undefined>;
    }
    interface FormulaValueProvider {
      getDefaults(schemaVersion: string, signal?: AbortSignal):
        Promise<FormulaValues>;
    }

Resolve metadata through orchestration and bind against a consistent snapshot. New metadata creates a new context revision and a recheck rather than mutating a result in use. Distinguish unavailable metadata from definitely unknown symbols. Bound queries, coalesce requests, cache by environment/user/context identity, invalidate revisions and dispose subscriptions. Schema discovery must not implicitly fetch runtime records.

**Future considerations:** Dataverse tables, relationships, choices, logical/display names and dynamic connector schemas. Large/recursive schemas need stable type identities and lazy field discovery. Metadata access requires a host-granted provider capability, separate from permission to execute business operations.

## 26. Reusable editor, PCF wrapper and expression testing

### 26.1 Monaco and React

**Decision:** Build a Monaco adapter around the language service, with Power Fx syntax coloring and provider mappings. A reusable React component accepts expression text, a change callback, context/provider, read-only state, options and injected services. It owns editor/model subscriptions and disposes them. A future alternative editor can consume the same service without React.

LSP is a parallel adapter, not a prerequisite for Monaco. Research the selected Monaco API and worker configuration before implementation.

### 26.2 Dataverse multiline-field PCF

**Decision:** The intended control binds a formula to a Dataverse multiline text column. Supported additional input properties supply schema configuration, context identity and selected values. The wrapper handles initialization, updateView, output notification/getOutputs and destruction. Host/form saving persists the field.

Handle null/initial values, disabled/read-only state, host refreshes and local edit synchronization without output feedback loops. Keep these concerns in PCF, not in the editor or engine.

Do not discover arbitrary form fields through unsupported APIs. Microsoft's [PCF limitations](https://learn.microsoft.com/en-us/power-apps/developer/component-framework/limitations) state the form-context boundary. A future metadata provider uses supported PCF/Dataverse access and environment permissions.

**Future considerations:** Standard PCF versus virtual React PCF, supported React/Fluent versions, Monaco DOM mounting, worker URLs/CSP, bundles, resizing, accessibility, dialog placement and external-service declarations. [Platform React libraries](https://learn.microsoft.com/en-us/power-apps/developer/component-framework/react-controls-platform-libraries) reduce duplicated UI dependencies, but do not prove Monaco hosting works. Validate in a deployed model-driven app as well as the harness; add other hosts only when they are explicit targets.

### 26.3 Test runner and dialog

**Decision:** The Test button opens a schema-driven dialog where users enter/override values, validate them, evaluate, and inspect typed results, diagnostics and elapsed time. The headless runner works in React, PCF and automated test contexts.

A session captures expression, schema revision, compatibility profile, values, mocks, execution policy and optional expected result. It rechecks when relevant inputs change and distinguishes input-validation errors, formula errors, host failures, cancellation and budget exhaustion. Preserve records/tables, dates, decimals and blank semantics; provide typed import for inputs without a specialized UI.

External operations, including external reads, are disabled or mocked by default. An unmocked call fails visibly. Live mode requires an explicit host grant and a clear UI choice; opening the dialog grants nothing. Running tests does not implicitly save formulas.

**Future considerations:** Saved cases, multiple scenarios, expected/actual comparison and richer result inspection. Avoid persisting sensitive production values in fixtures by default.

## 27. Worker compatibility, cancellation and resource limits

**Decision:** Core and interpreter import/run without window, document, React, Monaco, PCF or Node-specific APIs. Worker compatibility begins now; actual worker execution can be delivered later.

Worker boundary messages use versioned DTOs for schemas, type/value descriptors, diagnostics and requests. Class instances, callbacks, service objects, credentials and AbortSignal are not wire contracts. Keep providers on their owning side and communicate via explicit RPC or materialized snapshots. A compiled formula may use a worker-local handle invalidated on semantic-context changes.

Each request/response carries request identity, document revision and context revision. Discard stale diagnostics/completions even if cancellation arrives too late. Translate local cancellation into cancel messages and propagate it through metadata, checking, evaluation and connector transports.

Cooperative cancellation needs evaluator checkpoints and yielding. A busy worker cannot process a cancel message until its event loop runs; Promise-returning APIs alone do not keep the UI responsive. Hard timeouts can terminate/recreate a worker, invalidating handles and pending work.

Set budgets for source length, syntax depth, evaluation steps/call depth, table/result sizes, duration and external-operation counts. A worker is a responsiveness mechanism, not an authorization boundary or a sandbox for untrusted JavaScript host functions.

**Future considerations:** Scheduling strategy, transfer optimizations, compiled-handle lifecycle and host fallback when worker loading fails. Do not assume every PCF host permits the same worker packaging.

## 28. Capabilities and security across authoring, testing and execution

**Decision:** The host explicitly supplies symbols, functions, values and capabilities. Classify operations as pure/local, external read or write/action using descriptors; an HTTP verb alone is insufficient. Enforce an operation allow-list at runtime even after successful binding. Custom functions go through the same checks.

Authoring may request authorized metadata, but completion/checking never invokes connector business operations. Being visible in a schema does not grant execution permission.

Credentials remain in trusted host transports or gateways, never formula source, schema DTOs, saved cases or worker messages. Scope caches and capabilities to the environment/tenant/user. Gateway authorization must be enforced server-side; browser checks are insufficient.

Pure tests work locally. External tests default to mocks or deny. Production execution and explicitly enabled live tests pass capabilities, cancellation and budgets to transport calls. Cancellation cannot undo an already accepted remote write; action retries need an explicit idempotency policy.

The cloud-neutral transport/APIM/optional OSS gateway choices in Sections 13–14 remain. [APIM Credential Manager](https://learn.microsoft.com/en-us/azure/api-management/credentials-overview) supports OAuth connection/token handling; deployment recipes must verify current backend, tier and workspace constraints rather than assume universal support.

Constrained formulas improve safety only when the evaluator, marshalling and host-function boundaries implement these rules. They do not automatically make arbitrary extensions or unlimited computation safe.

## 29. Updated milestones, acceptance checks and open decisions

The original Phase 0–5 sequence remains. Add the following deliverables without moving connectors or gateway into the first language release:

| Phase                        | Added work / acceptance criteria                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0                            | Commit-pinned repo/test/license inventory; C#→TS component mapping; numeric/profile decisions; service/context/worker/capability ADRs; compatibility harness prototype |
| Early hosting experiment     | Minimal Monaco-in-PCF editor with mock services and test dialog; evidence for standard/virtual control, lifecycle, packaging and worker loading                        |
| 1                            | Recoverable parser and source ranges; schema/value separation; shared signatures; cancellation/budget boundaries; worker import and DTO round-trip verification        |
| 2                            | Profile-specific parity, decimal/coercion/timezone findings resolved, stable semantic snapshots, lazy-provider orchestration and runtime safety checks                 |
| 3                            | Shared authoring services; direct Monaco adapter; reusable React editor/test runner/dialog; LSP adapter informed by upstream tests                                     |
| Future PCF product milestone | Real multiline-column round trip, supported context inputs, schema-driven tests, read-only/null/refresh/disposal behavior and deployed-host validation                 |
| 4                            | Connector projection, effect descriptors, capability-controlled invocation, mocks, cancellable transport and authentication outside engine                             |
| 5                            | Optional gateway and current APIM/cloud recipes with server-side policy and tenant boundaries                                                                          |

Architectural verification must demonstrate:

- Completion and diagnostics work on incomplete formulas without evaluating them.
- Editor authoring and execution use the same types/function registry/profile.
- Schemas support IntelliSense without production values; invalid values fail validation.
- Slow/cancelled providers and old document/context responses cannot overwrite current results.
- Headless components run in browser, Node and worker targets without UI/platform imports.
- Default tests cannot invoke external operations; runtime grants remain necessary after checking.
- Monaco and LSP map source ranges consistently, including Unicode and multiline formulas.
- PCF output/lifecycle behavior is verified by the hosting experiment before production packaging choices.

**Decisions made now:** platform independence; shared semantics; expression/schema/value separation; extensible providers; reusable adapters/editor/testing; versioned/cancellable boundaries; capability enforcement; research and component design before porting.

**Future considerations requiring evidence:** exact packages/runtime targets, decimal implementation library, full LSP feature coverage, incremental parsing, Dataverse metadata breadth, standard/virtual PCF, worker hosting, UI libraries, saved tests, UDF/UDT/delegation scope and expanded connector extensions.

The immediate next work is a commit-pinned research/design baseline and compatibility runner, followed by one tested end-to-end language slice. The early UI hosting experiment validates integration assumptions with mocks; it does not replace the language-first roadmap.
