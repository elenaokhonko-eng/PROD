// A file is read in parts and joined, so that no page is lost to one answer's limit (requirements 9.2, 27 Nov 2026:
// from 5 pages up the stored text was almost empty while the file showed as ready).

export const PAGES_PER_PART = 3;

/** Page indexes of each part, in order. */
export function partPageRanges(pageCount: number): number[][] {
  const ranges: number[][] = [];
  for (let start = 0; start < pageCount; start += PAGES_PER_PART) {
    ranges.push(Array.from({ length: Math.min(PAGES_PER_PART, pageCount - start) }, (_, i) => start + i));
  }
  return ranges;
}

// A line standing for text that was left out. Dots inside a sentence are not one.
const LEFT_OUT = /^[ \t]*(?:\.{3,}|…|\[[ \t]*(?:\.{3}|…|truncated|continued|omitted)[ \t]*\])[ \t]*$/im;

/** An empty or abbreviated part is a failed reading, never a short one. */
export function assertCompleteText(text: string): void {
  if (!text.trim() || LEFT_OUT.test(text)) throw new Error("document_part_abbreviated");
}
