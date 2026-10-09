import { describe, expect, it } from "vitest";
import { LineMap, lex, parse, type ExpressionNode } from "../src/index.js";

const show = (n: ExpressionNode): string => {
  switch (n.kind) {
    case "NumberLiteral":
      return n.text;
    case "StringLiteral":
      return JSON.stringify(n.value);
    case "BooleanLiteral":
      return String(n.value);
    case "Name":
      return n.name;
    case "DottedName":
      return `${show(n.left)}.${n.right.kind === "Name" ? n.right.name : "?"}`;
    case "Call":
      return `${n.callee.name}(${n.args.map(show).join(",")})`;
    case "Unary":
      return `(${n.op} ${show(n.operand)})`;
    case "Binary":
      return `(${show(n.left)} ${n.op} ${show(n.right)})`;
    case "Group":
      return `[${show(n.expression)}]`;
    case "Record":
      return `{${n.fields.map((f) => `${f.name.kind === "Name" ? f.name.name : "?"}:${show(f.value)}`).join(",")}}`;
    case "Table":
      return `T[${n.items.map(show).join(",")}]`;
    case "Chain":
      return `chain<${n.items.map(show).join(";")}>`;
    case "Missing":
      return "<missing>";
    case "Error":
      return "<error>";
  }
};
const p = (s: string, o = {}) => show(parse(s, o).root);

describe("lexer", () => {
  it("round-trips text including trivia", () => {
    const src = 'Sum(1.5e3, "a""b") // hi\n + \'my name\'';
    expect(
      lex(src)
        .tokens.map((t) => t.text)
        .join(""),
    ).toBe(src);
  });
  it("unescapes strings and quoted identifiers", () => {
    const t = lex(`"a""b" 'it''s'`).tokens.filter((x) => x.value !== undefined);
    expect(t.map((x) => x.value)).toEqual(['a"b', "it's"]);
  });
  it("reports unterminated string and bad chars", () => {
    expect(lex('"abc').diagnostics[0]?.code).toBe("PFX1005");
    expect(lex("1 # 2").diagnostics[0]?.code).toBe("PFX1004");
  });
  it("handles non-BMP characters as one unexpected character", () => {
    const r = lex("😀");
    expect(r.diagnostics[0]?.span).toEqual({ start: 0, end: 2 });
  });
  it("treats `1.` as number then dot, and `1.2.3` as two numbers", () => {
    expect(
      lex("1.x")
        .tokens.map((t) => t.kind)
        .slice(0, 3),
    ).toEqual(["Number", "Dot", "Ident"]);
    const r = lex("1.2.3");
    expect(r.diagnostics).toEqual([]);
    expect(r.tokens.filter((t) => t.kind === "Number").map((t) => t.text)).toEqual(["1.2", ".3"]);
  });
  it("rejects too-large numbers", () => {
    expect(lex("1e999").diagnostics[0]?.code).toBe("PFX1008");
  });
});

describe("parser", () => {
  it("honors precedence and associativity", () => {
    expect(p("1+2*3")).toBe("(1 Add (2 Mul 3))");
    expect(p("1-2-3")).toBe("((1 Sub 2) Sub 3)");
    expect(p("-2^2")).toBe("(Negate (2 Power 2))");
    expect(p("2^3^2")).toBe("(2 Power (3 Power 2))");
    expect(p("a&b=c")).toBe("((a Concat b) Eq c)");
    expect(p("a||b&&c")).toBe("(a Or (b And c))");
    expect(p("a Or b And c")).toBe("(a Or (b And c))");
    expect(p("50%+1")).toBe("((Percent 50) Add 1)");
  });
  it("parses calls, records, tables, dotted names, Not", () => {
    expect(p("If(a, 1, 2)")).toBe("If(a,1,2)");
    expect(p("{a:1, 'b c':2}")).toBe("{a:1,b c:2}");
    expect(p("[1,2]")).toBe("T[1,2]");
    expect(p("a.b.c")).toBe("a.b.c");
    expect(p("!a")).toBe("(Not a)");
    expect(p("Not a")).toBe("(Not a)");
    expect(p("Not(a)")).toBe("Not(a)");
    expect(p("And(a,b)")).toBe("And(a,b)");
    expect(p("F()")).toBe("F()");
  });
  it("chains only when enabled", () => {
    expect(p("a;b", { allowChaining: true })).toBe("chain<a;b>");
    expect(parse("a;b").diagnostics.length).toBeGreaterThan(0);
  });
  it("recovers from a missing right operand", () => {
    const r = parse("Filter(Accounts, Revenue >");
    expect(show(r.root)).toBe("Filter(Accounts,(Revenue Gt <missing>))");
    expect(r.diagnostics.map((d) => d.code)).toEqual(["PFX1001", "PFX1003"]);
    expect(r.diagnostics[0]?.span).toEqual({ start: 26, end: 26 });
  });
  it("recovers from unclosed brackets", () => {
    expect(p("(1+2")).toBe("[(1 Add 2)]");
    expect(parse("(1+2").diagnostics[0]?.code).toBe("PFX1003");
    expect(p("[1,2")).toBe("T[1,2]");
    expect(p("{a:1")).toBe("{a:1}");
  });
  it("recovers after empty argument", () => {
    const r = parse("F(1,,2)");
    expect(show(r.root)).toBe("F(1,<error>,2)");
    expect(r.diagnostics.map((d) => [d.code, d.span])).toEqual([["PFX1012", { start: 4, end: 5 }]]);
  });
  it("handles empty input", () => {
    const r = parse("");
    expect(r.root.kind).toBe("Missing");
    expect(r.diagnostics[0]?.code).toBe("PFX1001");
  });
  it("reports stray tokens as operator expected without throwing", () => {
    const r = parse("1 2 3");
    expect(r.diagnostics[0]?.code).toBe("PFX1002");
  });
  it("reports a misplaced operand once and recovers like upstream", () => {
    const msgs = (src: string) =>
      parse(src).diagnostics.map((d) => `${d.span.start}-${d.span.end} ${d.code}`);
    expect(msgs("1.2.3")).toEqual(["3-5 PFX1002", "5-5 PFX1001"]);
    expect(msgs("1.2.3 + 1.2.3")).toEqual(["3-5 PFX1002", "6-7 PFX1012", "8-11 PFX1002"]);
    expect(msgs("1 2 3")).toEqual(["2-3 PFX1002"]);
  });
  it("names tokens with upstream TokKind names", () => {
    expect(parse("Blank(").diagnostics.map((d) => d.message)).toEqual([
      expect.stringMatching(/^Expected an operand\./),
      "Unexpected characters. The formula contains 'Eof' where 'ParenClose' is expected.",
    ]);
    expect(parse("{a:1").diagnostics[0]?.message).toContain("where 'CurlyClose' is expected");
  });
  it("reports a stray closer once as unexpected characters", () => {
    expect(parse("1 )").diagnostics.map((d) => d.code)).toEqual(["PFX1012"]);
  });
  it("enforces the nesting limit without a stack overflow", () => {
    const src = "(".repeat(5000) + "1" + ")".repeat(5000);
    const r = parse(src);
    expect(r.diagnostics.some((d) => d.code === "PFX1010")).toBe(true);
  });
  it("keeps node spans accurate with CRLF and non-BMP text", () => {
    const src = '"😀"\r\n+ 1';
    const r = parse(src);
    expect(r.root.span).toEqual({ start: 0, end: src.length });
    expect(new LineMap(src).positionAt(src.indexOf("+"))).toEqual({ line: 1, column: 0 });
  });
});
