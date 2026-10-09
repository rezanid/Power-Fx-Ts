import {
  createDiagnostic,
  DiagnosticCodes,
  type Diagnostic,
  type DiagnosticCode,
} from "../diagnostics/diagnostic.js";
import { lex } from "../lexer/lexer.js";
import { isTrivia, upstreamKindName, type Token, type TokenKind } from "../lexer/tokens.js";
import type {
  BinaryOperator,
  ErrorNode,
  ExpressionNode,
  MissingNode,
  NameNode,
  RecordFieldNode,
} from "../syntax/nodes.js";
import type { Span } from "../text/span.js";

export interface ParseOptions {
  /** Enable `a; b` expression chaining (behavior formulas). Default false. */
  readonly allowChaining?: boolean;
  /** Maximum expression nesting. Default 200. */
  readonly maxDepth?: number;
  /** Literal typing and range: `float` (default) or `decimal` (upstream NumberIsFloat off). */
  readonly numberMode?: "float" | "decimal";
}

export interface ParseResult {
  readonly root: ExpressionNode;
  /** Every token including trivia and the trailing Eof. */
  readonly tokens: readonly Token[];
  /** Lexer and parser diagnostics, ordered by position. */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * Valid upstream syntax this parser does not implement (string interpolation, `Type(...)`). When
   * present, `diagnostics` keeps only errors that end before the first such construct; malformed
   * syntax after it cannot be told apart from valid syntax we do not understand.
   */
  readonly unsupportedSyntax: readonly { readonly feature: string; readonly span: Span }[];
}

// Higher binds tighter. Mirrors upstream Power Fx precedence.
const enum Prec {
  None = 0,
  Or = 1,
  And = 2,
  In = 3,
  Compare = 4,
  Concat = 5,
  Add = 6,
  Mul = 7,
  As = 8,
  PrefixUnary = 9,
  Power = 10,
  Postfix = 11,
}

const STARTS_OPERAND_AFTER_OPERAND: ReadonlySet<TokenKind> = new Set([
  "Ident",
  "Number",
  "String",
  "True",
  "False",
]);

const BINARY: Partial<Record<TokenKind, [BinaryOperator, Prec]>> = {
  PipePipe: ["Or", Prec.Or],
  AmpAmp: ["And", Prec.And],
  In: ["In", Prec.In],
  Exactin: ["Exactin", Prec.In],
  Eq: ["Eq", Prec.Compare],
  LtGt: ["Neq", Prec.Compare],
  Lt: ["Lt", Prec.Compare],
  LtEq: ["LtEq", Prec.Compare],
  Gt: ["Gt", Prec.Compare],
  GtEq: ["GtEq", Prec.Compare],
  Amp: ["Concat", Prec.Concat],
  Plus: ["Add", Prec.Add],
  Minus: ["Sub", Prec.Add],
  Star: ["Mul", Prec.Mul],
  Slash: ["Div", Prec.Mul],
  Caret: ["Power", Prec.Power],
};

export function parse(text: string, options: ParseOptions = {}): ParseResult {
  const lexed = lex(
    text,
    options.numberMode === undefined ? {} : { numberMode: options.numberMode },
  );
  const parser = new Parser(lexed.tokens, options);
  const root = parser.parseRoot();
  const diagnostics = [...lexed.diagnostics, ...parser.diagnostics].sort(
    (a, b) => a.span.start - b.span.start || a.span.end - b.span.end,
  );
  const unsupportedSyntax = findUnsupportedSyntax(text, lexed.tokens);
  return {
    root,
    tokens: lexed.tokens,
    diagnostics: trustedDiagnostics(diagnostics, unsupportedSyntax),
    unsupportedSyntax,
  };
}

/**
 * The parser works left to right, so errors that end before the first unsupported construct are
 * genuine. Anything at or after it may be an artifact of not understanding that syntax.
 */
function trustedDiagnostics(
  diagnostics: readonly Diagnostic[],
  unsupported: ParseResult["unsupportedSyntax"],
): readonly Diagnostic[] {
  if (unsupported.length === 0) return diagnostics;
  const first = Math.min(...unsupported.map((u) => u.span.start));
  return diagnostics.filter((d) => d.span.end <= first);
}

function findUnsupportedSyntax(
  text: string,
  tokens: readonly Token[],
): ParseResult["unsupportedSyntax"] {
  const sig = tokens.filter((t) => !isTrivia(t.kind));
  const found: { feature: string; span: Span }[] = [];
  sig.forEach((t, i) => {
    const next = sig[i + 1];
    if (t.text === "$" && text[t.span.end] === '"') {
      found.push({ feature: "String interpolation", span: t.span });
    } else if (t.kind === "Ident" && t.text === "Type" && next?.kind === "ParenOpen") {
      found.push({ feature: "Type literal", span: t.span });
    }
  });
  return found;
}

class Parser {
  readonly diagnostics: Diagnostic[] = [];
  private readonly sig: Token[];
  private i = 0;
  private depth = 0;
  private aborted = false;
  private readonly maxDepth: number;
  private readonly allowChaining: boolean;

  constructor(allTokens: readonly Token[], options: ParseOptions) {
    this.sig = allTokens.filter((t) => !isTrivia(t.kind));
    this.maxDepth = options.maxDepth ?? 200;
    this.allowChaining = options.allowChaining ?? false;
  }

  private get cur(): Token {
    return this.sig[this.i]!;
  }

  private at(kind: TokenKind): boolean {
    return this.cur.kind === kind;
  }

  private peek(n = 1): Token {
    return this.sig[Math.min(this.i + n, this.sig.length - 1)]!;
  }

  private next(): Token {
    const t = this.cur;
    if (t.kind !== "Eof") this.i++;
    return t;
  }

  private report(code: DiagnosticCode, span: Span, args: string[] = []): void {
    this.diagnostics.push(createDiagnostic(code, span, args));
  }

  private get prevEnd(): number {
    return this.i > 0 ? this.sig[this.i - 1]!.span.end : 0;
  }

  private missing(): MissingNode {
    return { kind: "Missing", span: { start: this.cur.span.start, end: this.cur.span.start } };
  }

  parseRoot(): ExpressionNode {
    let root = this.parseExpr(Prec.None);
    const leftovers: Token[] = [];
    // Like upstream, one diagnostic marks where parsing stopped; the rest is skipped silently.
    if (!this.at("Eof") && !this.at("Error") && !this.aborted) {
      this.report(DiagnosticCodes.BadToken, this.cur.span);
    }
    while (!this.at("Eof")) leftovers.push(this.next());
    if (leftovers.length > 0) {
      const err: ErrorNode = {
        kind: "Error",
        tokens: leftovers,
        span: { start: leftovers[0]!.span.start, end: leftovers[leftovers.length - 1]!.span.end },
      };
      root = {
        kind: "Chain",
        items: [root, err],
        span: { start: root.span.start, end: err.span.end },
      };
    }
    return root;
  }

  private parseExpr(minPrec: Prec): ExpressionNode {
    if (this.depth >= this.maxDepth) {
      if (!this.aborted) {
        this.aborted = true;
        this.report(DiagnosticCodes.NestedTooDeeply, this.cur.span);
      }
      const toks: Token[] = [];
      while (!this.at("Eof")) toks.push(this.next());
      const start = toks[0]?.span.start ?? this.cur.span.start;
      return {
        kind: "Error",
        tokens: toks,
        span: { start, end: this.prevEnd < start ? start : this.prevEnd },
      };
    }
    this.depth++;
    try {
      let left = this.parseOperand();
      for (;;) {
        const t = this.cur;

        if (t.kind === "Percent" && minPrec <= Prec.Postfix) {
          this.next();
          left = {
            kind: "Unary",
            op: "Percent",
            operand: left,
            span: { start: left.span.start, end: t.span.end },
          };
          continue;
        }

        if (t.kind === "Dot") {
          this.next();
          const right = this.parseMemberName();
          left = {
            kind: "DottedName",
            left,
            right,
            dot: t.span,
            span: { start: left.span.start, end: right.span.end },
          };
          continue;
        }

        if (t.kind === "As" && minPrec <= Prec.As) {
          this.next();
          const name = this.parseMemberName();
          left = {
            kind: "As",
            left,
            name,
            span: { start: left.span.start, end: Math.max(name.span.end, this.prevEnd) },
          };
          continue;
        }

        if (t.kind === "Semicolon" && this.allowChaining && minPrec === Prec.None) {
          left = this.parseChain(left);
          continue;
        }

        const op = this.binaryOp(t);
        // Without chaining, upstream routes `;` through the same operator-expected path.
        if (
          !op &&
          (STARTS_OPERAND_AFTER_OPERAND.has(t.kind) ||
            (t.kind === "Semicolon" && !this.allowChaining))
        ) {
          // Upstream: report, consume the token, and parse what follows as the right operand.
          this.report(DiagnosticCodes.OperatorExpected, t.span);
          this.next();
          const right = this.parseExpr(Prec.Or);
          left = {
            kind: "Error",
            tokens: [t],
            operands: [left, right],
            span: { start: left.span.start, end: this.endAfter(right) },
          };
          continue;
        }
        if (!op) return left;
        const [operator, prec] = op;
        if (prec < minPrec) return left;
        this.next();
        // Power is right-associative; everything else is left-associative.
        const right = this.parseExpr(operator === "Power" ? Prec.PrefixUnary : prec + 1);
        left = {
          kind: "Binary",
          op: operator,
          left,
          right,
          span: { start: left.span.start, end: right.span.end },
        };
      }
    } finally {
      this.depth--;
    }
  }

  private binaryOp(t: Token): [BinaryOperator, Prec] | undefined {
    const direct = BINARY[t.kind];
    if (direct) return direct;
    // `And` / `Or` as infix words; as a call they are handled in operand position.
    if (t.kind === "Ident" && t.text === "And") return ["And", Prec.And];
    if (t.kind === "Ident" && t.text === "Or") return ["Or", Prec.Or];
    return undefined;
  }

  private parseChain(first: ExpressionNode): ExpressionNode {
    const items = [first];
    while (this.at("Semicolon")) {
      this.next();
      if (this.at("Eof") || this.at("ParenClose")) break;
      items.push(this.parseExpr(Prec.Or));
    }
    const last = items[items.length - 1]!;
    return {
      kind: "Chain",
      items,
      span: { start: first.span.start, end: Math.max(last.span.end, this.prevEnd) },
    };
  }

  private parseMemberName(): NameNode | MissingNode {
    const t = this.cur;
    if (t.kind === "Ident") {
      this.next();
      return {
        kind: "Name",
        name: t.value ?? t.text,
        quoted: t.text.startsWith("'"),
        span: t.span,
      };
    }
    this.report(DiagnosticCodes.ExpectedToken, t.span, [
      upstreamKindName(t.kind),
      upstreamKindName("Ident"),
    ]);
    return this.missing();
  }

  private parseOperand(): ExpressionNode {
    const t = this.cur;
    switch (t.kind) {
      case "Number":
        this.next();
        return { kind: "NumberLiteral", text: t.text, span: t.span };
      case "String":
        this.next();
        return { kind: "StringLiteral", value: t.value ?? "", span: t.span };
      case "True":
      case "False":
        this.next();
        return { kind: "BooleanLiteral", value: t.kind === "True", span: t.span };
      case "Minus": {
        this.next();
        const operand = this.parseExpr(Prec.PrefixUnary);
        return {
          kind: "Unary",
          op: "Negate",
          operand,
          span: { start: t.span.start, end: operand.span.end },
        };
      }
      case "Bang": {
        this.next();
        const operand = this.parseExpr(Prec.PrefixUnary);
        return {
          kind: "Unary",
          op: "Not",
          operand,
          span: { start: t.span.start, end: operand.span.end },
        };
      }
      case "Ident":
        return this.parseIdentOrCall();
      case "ParenOpen": {
        this.next();
        const expression = this.parseExpr(Prec.None);
        const closed = this.expect("ParenClose");
        return {
          kind: "Group",
          expression,
          closed,
          span: { start: t.span.start, end: this.endAfter(expression) },
        };
      }
      case "BraceOpen":
        return this.parseRecord();
      case "BracketOpen":
        return this.parseTable();
      case "Error": {
        this.next();
        if (t.value !== undefined) this.report(DiagnosticCodes.ReservedWord, t.span);
        return { kind: "Error", tokens: [t], span: t.span };
      }
      case "Eof":
      case "Semicolon":
        this.report(DiagnosticCodes.OperandExpected, t.span);
        return this.missing();
      default:
        // Upstream consumes an unexpected token in operand position as an error node.
        this.next();
        this.report(DiagnosticCodes.BadToken, t.span);
        return { kind: "Error", tokens: [t], span: t.span };
    }
  }

  private endAfter(last: ExpressionNode): number {
    return Math.max(last.span.end, this.prevEnd);
  }

  private parseIdentOrCall(): ExpressionNode {
    const t = this.next();
    const quoted = t.text.startsWith("'");
    const name: NameNode = { kind: "Name", name: t.value ?? t.text, quoted, span: t.span };

    if (!quoted && t.text === "Not" && !this.at("ParenOpen")) {
      const operand = this.parseExpr(Prec.PrefixUnary);
      return {
        kind: "Unary",
        op: "Not",
        operand,
        span: { start: t.span.start, end: operand.span.end },
      };
    }

    if (!this.at("ParenOpen")) return name;
    this.next();
    const args: ExpressionNode[] = [];
    if (!this.at("ParenClose")) {
      for (;;) {
        while (this.at("Comma")) {
          const comma = this.next();
          this.report(DiagnosticCodes.BadToken, comma.span);
          args.push({ kind: "Error", tokens: [comma], span: comma.span });
        }
        args.push(this.parseExpr(Prec.None));
        if (this.at("Comma")) {
          this.next();
          continue;
        }
        break;
      }
    }
    const closed = this.expect("ParenClose");
    return {
      kind: "Call",
      callee: name,
      args,
      closed,
      span: { start: t.span.start, end: Math.max(this.prevEnd, t.span.end) },
    };
  }

  private parseRecord(): ExpressionNode {
    const open = this.next();
    const fields: RecordFieldNode[] = [];
    if (!this.at("BraceClose")) {
      for (;;) {
        const field = this.parseField();
        fields.push(field);
        // Upstream stops the field list after a missing colon.
        if (field.value.kind === "Error" && field.colonMissing) break;
        if (this.at("Comma")) {
          this.next();
          continue;
        }
        break;
      }
    }
    const closed = this.expect("BraceClose");
    return {
      kind: "Record",
      fields,
      closed,
      span: { start: open.span.start, end: Math.max(this.prevEnd, open.span.end) },
    };
  }

  private parseField(): RecordFieldNode {
    const name = this.parseMemberName();
    if (!this.expect("Colon")) {
      // Upstream consumes the offending token as the field's value and reports a colon error.
      const bad = this.cur;
      if (bad.kind !== "Eof") this.next();
      this.report(DiagnosticCodes.ColonExpected, bad.span);
      const value: ExpressionNode = { kind: "Error", tokens: [bad], span: bad.span };
      return {
        kind: "RecordField",
        name,
        value,
        colonMissing: true,
        span: { start: name.span.start, end: bad.span.end },
      };
    }
    const value = this.parseExpr(Prec.None);
    return {
      kind: "RecordField",
      name,
      value,
      span: { start: name.span.start, end: Math.max(value.span.end, this.prevEnd) },
    };
  }

  private parseTable(): ExpressionNode {
    const open = this.next();
    const items: ExpressionNode[] = [];
    // Like upstream, a trailing comma before `]` is accepted.
    while (!this.at("BracketClose")) {
      items.push(this.parseExpr(Prec.None));
      if (!this.at("Comma")) break;
      this.next();
    }
    const closed = this.expect("BracketClose");
    return {
      kind: "Table",
      items,
      closed,
      span: { start: open.span.start, end: Math.max(this.prevEnd, open.span.end) },
    };
  }

  /** Consumes the token if present; otherwise reports and leaves the cursor alone. */
  private expect(kind: TokenKind): boolean {
    if (this.cur.kind === kind) {
      this.next();
      return true;
    }
    this.report(DiagnosticCodes.ExpectedToken, this.cur.span, [
      upstreamKindName(this.cur.kind),
      upstreamKindName(kind),
    ]);
    return false;
  }
}
