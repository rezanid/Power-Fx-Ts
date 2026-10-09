export * from "./text/span.js";
export * from "./diagnostics/diagnostic.js";
export * from "./lexer/tokens.js";
export { lex, type LexResult } from "./lexer/lexer.js";
export * from "./syntax/nodes.js";
export { parse, type ParseOptions, type ParseResult } from "./parser/parser.js";

export const PACKAGE_NAME = "@powerfx-ts/core";
