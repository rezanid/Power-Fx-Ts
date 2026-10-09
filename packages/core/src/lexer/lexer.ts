import { createDiagnostic, DiagnosticCodes, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { Token, TokenKind } from "./tokens.js";

export interface LexResult {
  /** All tokens including trivia, terminated by an Eof token. */
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

const KEYWORDS: Readonly<Record<string, TokenKind>> = {
  true: "True",
  false: "False",
  in: "In",
  exactin: "Exactin",
};

const IDENT_START = /[\p{L}\p{Nl}_]/u;
const IDENT_PART = /[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}_]/u;
const SPACE = /[\p{Zs}\t]/u;

function isLineBreak(c: string): boolean {
  return c === "\n" || c === "\r" || c === "\u0085" || c === "\u2028" || c === "\u2029";
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

/** Maximum finite value of a 64-bit float; larger literals are rejected. */
const MAX_NUMBER = Number.MAX_VALUE;

export function lex(text: string): LexResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let pos = 0;

  const push = (kind: TokenKind, start: number, end: number, value?: string): void => {
    const t = { kind, span: { start, end }, text: text.slice(start, end) };
    tokens.push(value === undefined ? t : { ...t, value });
  };
  const fail = (
    start: number,
    end: number,
    code: Parameters<typeof createDiagnostic>[0],
    args: string[] = [],
  ): void => {
    diagnostics.push(createDiagnostic(code, { start, end }, args));
    push("Error", start, end);
  };

  const codePointAt = (i: number): string => {
    const cp = text.codePointAt(i);
    return cp === undefined ? "" : String.fromCodePoint(cp);
  };

  while (pos < text.length) {
    const start = pos;
    const ch = codePointAt(pos);

    if (isLineBreak(ch) || SPACE.test(ch)) {
      while (pos < text.length) {
        const c = codePointAt(pos);
        if (!isLineBreak(c) && !SPACE.test(c)) break;
        pos += c.length;
      }
      push("Whitespace", start, pos);
      continue;
    }

    if (ch === "/" && text[pos + 1] === "/") {
      while (pos < text.length && !isLineBreak(text[pos]!)) pos++;
      push("Comment", start, pos);
      continue;
    }
    if (ch === "/" && text[pos + 1] === "*") {
      const close = text.indexOf("*/", pos + 2);
      if (close < 0) {
        pos = text.length;
        fail(start, pos, DiagnosticCodes.UnterminatedComment);
      } else {
        pos = close + 2;
        push("Comment", start, pos);
      }
      continue;
    }

    if (ch === '"') {
      pos++;
      let value = "";
      let closed = false;
      while (pos < text.length) {
        if (text[pos] === '"') {
          if (text[pos + 1] === '"') {
            value += '"';
            pos += 2;
            continue;
          }
          pos++;
          closed = true;
          break;
        }
        value += text[pos];
        pos++;
      }
      if (closed) push("String", start, pos, value);
      else fail(start, pos, DiagnosticCodes.UnterminatedString);
      continue;
    }

    if (ch === "'") {
      pos++;
      let value = "";
      let closed = false;
      while (pos < text.length && !isLineBreak(text[pos]!)) {
        if (text[pos] === "'") {
          if (text[pos + 1] === "'") {
            value += "'";
            pos += 2;
            continue;
          }
          pos++;
          closed = true;
          break;
        }
        value += text[pos];
        pos++;
      }
      if (closed) push("Ident", start, pos, value);
      else fail(start, pos, DiagnosticCodes.UnterminatedIdentifier);
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(text[pos + 1]))) {
      let sawDot = false;
      while (pos < text.length) {
        const c = text[pos];
        if (isDigit(c)) pos++;
        else if (c === "." && !sawDot && isDigit(text[pos + 1])) {
          sawDot = true;
          pos++;
        } else break;
      }
      if (text[pos] === "e" || text[pos] === "E") {
        let p = pos + 1;
        if (text[p] === "+" || text[p] === "-") p++;
        if (isDigit(text[p])) {
          while (isDigit(text[p])) p++;
          pos = p;
        }
      }
      if (text[pos] === "." && isDigit(text[pos + 1])) {
        while (text[pos] === "." || isDigit(text[pos])) pos++;
        fail(start, pos, DiagnosticCodes.InvalidNumber);
        continue;
      }
      if (Math.abs(Number(text.slice(start, pos))) > MAX_NUMBER) {
        fail(start, pos, DiagnosticCodes.NumberTooLarge);
        continue;
      }
      push("Number", start, pos);
      continue;
    }

    if (IDENT_START.test(ch)) {
      while (pos < text.length) {
        const c = codePointAt(pos);
        if (!IDENT_PART.test(c)) break;
        pos += c.length;
      }
      const word = text.slice(start, pos);
      const kw = Object.hasOwn(KEYWORDS, word) ? KEYWORDS[word] : undefined;
      push(kw ?? "Ident", start, pos, word);
      continue;
    }

    const two = text.slice(pos, pos + 2);
    const twoKind: Record<string, TokenKind> = {
      "<=": "LtEq",
      ">=": "GtEq",
      "<>": "LtGt",
      "&&": "AmpAmp",
      "||": "PipePipe",
    };
    if (Object.hasOwn(twoKind, two)) {
      pos += 2;
      push(twoKind[two]!, start, pos);
      continue;
    }

    const oneKind: Record<string, TokenKind> = {
      "+": "Plus",
      "-": "Minus",
      "*": "Star",
      "/": "Slash",
      "^": "Caret",
      "%": "Percent",
      "&": "Amp",
      "!": "Bang",
      "=": "Eq",
      "<": "Lt",
      ">": "Gt",
      ",": "Comma",
      ".": "Dot",
      ":": "Colon",
      ";": "Semicolon",
      "(": "ParenOpen",
      ")": "ParenClose",
      "{": "BraceOpen",
      "}": "BraceClose",
      "[": "BracketOpen",
      "]": "BracketClose",
    };
    if (Object.hasOwn(oneKind, ch)) {
      pos += 1;
      push(oneKind[ch]!, start, pos);
      continue;
    }

    pos += ch.length;
    fail(start, pos, DiagnosticCodes.UnexpectedCharacters, [ch]);
  }

  push("Eof", text.length, text.length);
  return { tokens, diagnostics };
}
