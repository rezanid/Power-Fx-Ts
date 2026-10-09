/** Half-open UTF-16 source range: [start, end). */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export function span(start: number, end: number): Span {
  return { start, end };
}

export function spanLength(s: Span): number {
  return s.end - s.start;
}

/** Smallest span covering both inputs. */
export function spanUnion(a: Span, b: Span): Span {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

export interface LinePosition {
  /** Zero-based line. */
  readonly line: number;
  /** Zero-based UTF-16 column. */
  readonly column: number;
}

/** Maps UTF-16 offsets to line/column. Lines end at \n, \r\n, \r, U+0085, U+2028 or U+2029. */
export class LineMap {
  private readonly lineStarts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 0x0d) {
        if (text.charCodeAt(i + 1) === 0x0a) i++;
        this.lineStarts.push(i + 1);
      } else if (c === 0x0a || c === 0x85 || c === 0x2028 || c === 0x2029) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  positionAt(offset: number): LinePosition {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, column: offset - this.lineStarts[lo]! };
  }
}
