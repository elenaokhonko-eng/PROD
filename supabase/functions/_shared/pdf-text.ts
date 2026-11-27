// A PDF's own text, rebuilt into lines by position, so a statement's columns stay on their row whatever order the file
// stores them in (requirements 8.1, 9.2; 28 Nov 2026). It is checked against the AI reading: the same money amounts,
// the same number of times. Where they differ, the reading has failed.

export interface TextPiece {
  str: string;
  /** Position on the page; y grows upwards, as in a PDF. */
  x: number;
  y: number;
}

const SAME_LINE = 3;

export function linesFromPieces(pieces: readonly TextPiece[]): string {
  const rows: Array<{ y: number; pieces: TextPiece[] }> = [];
  for (const piece of [...pieces].filter((p) => p.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - piece.y) <= SAME_LINE) row.pieces.push(piece);
    else rows.push({ y: piece.y, pieces: [piece] });
  }
  return rows.map((row) => row.pieces.sort((a, b) => a.x - b.x).map((p) => p.str.trim()).join(" ")).join("\n");
}

/** A page with fewer characters than this may be a scan. */
const MIN_TEXT_PER_PAGE = 100;

/**
 * Whether the file's own text can stand for the whole file: every page holds text. One page without it, and the file
 * is read by the AI alone, so a scanned page among typed ones is never dropped.
 */
export function ownTextCoversPages(pages: readonly string[]): boolean {
  return pages.length > 0 && pages.every((page) => page.replace(/\s/g, "").length >= MIN_TEXT_PER_PAGE);
}

const AMOUNT = /(?<![\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?![\d])/g;

function amounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.match(AMOUNT) ?? []) {
    const key = match.replace(/,/g, "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** How many money amounts one reading has that the other lacks, each way. */
export function amountMismatch(direct: string, read: string): { missing: number; added: number } {
  const a = amounts(direct);
  const b = amounts(read);
  const over = (from: Map<string, number>, to: Map<string, number>) =>
    [...from].reduce((sum, [key, n]) => sum + Math.max(0, n - (to.get(key) ?? 0)), 0);
  return { missing: over(a, b), added: over(b, a) };
}
