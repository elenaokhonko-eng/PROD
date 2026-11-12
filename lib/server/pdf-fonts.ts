import { readFileSync } from "node:fs"
import { join } from "node:path"
// @pdf-lib/fontkit's complex-script shaper (Tamil) expects a global regeneratorRuntime.
import "regenerator-runtime/runtime"
import fontkit from "@pdf-lib/fontkit"
import type { PDFDocument, PDFFont, PDFPage, RGB } from "pdf-lib"

// Unicode fonts for the PDFs (Elena, 9 Nov): a Singapore user's own name must print as written, whether in Chinese,
// Tamil or Latin with symbols such as "·" and curly quotes. Noto Sans (SIL Open Font License, assets/fonts/noto/OFL.txt)
// covers Latin, Greek, Cyrillic and common symbols; Noto Sans Tamil and Noto Sans SC cover the other scripts. Each run
// of text is drawn with the first face that has its glyphs; fonts are subset, so a PDF carries only the glyphs it uses.
// Only characters no face has (emoji, for example) still print as "?".

const FONT_DIR = join(process.cwd(), "assets", "fonts", "noto")

export const PDF_FONT_FILES = {
  regular: ["NotoSans-Regular.ttf", "NotoSansTamil-Regular.ttf", "NotoSansSC-Regular.ttf"],
  // There is no bold Chinese face: Chinese in a heading prints in the regular weight.
  bold: ["NotoSans-Bold.ttf", "NotoSansTamil-Bold.ttf", "NotoSansSC-Regular.ttf"],
} as const

export type FontWeight = keyof typeof PDF_FONT_FILES

// Font files are read once per process; each document embeds (and subsets) the faces it actually uses.
const fileBytes = new Map<string, Uint8Array>()
const coverage = new Map<string, (codePoint: number) => boolean>()

function bytesOf(file: string): Uint8Array {
  let bytes = fileBytes.get(file)
  if (!bytes) {
    bytes = new Uint8Array(readFileSync(join(FONT_DIR, file)))
    fileBytes.set(file, bytes)
  }
  return bytes
}

function covers(file: string, codePoint: number): boolean {
  let has = coverage.get(file)
  if (!has) {
    const font = fontkit.create(bytesOf(file))
    has = (cp: number) => font.hasGlyphForCodePoint(cp)
    coverage.set(file, has)
  }
  return has(codePoint)
}

const MISSING = "?"
// Combining marks and joiners stay with the character before them, so a Tamil vowel sign is shaped with its consonant.
const ATTACHES = /^[\p{M}‌‍]$/u

export type TextRun = { file: string; text: string }

/** Splits text into runs, each drawn with one face. Characters no face covers become "?". */
export function fontRuns(text: string, weight: FontWeight = "regular"): TextRun[] {
  const files = PDF_FONT_FILES[weight]
  const runs: TextRun[] = []
  for (const char of text) {
    const last = runs[runs.length - 1]
    const cp = char.codePointAt(0)!
    if (last && ATTACHES.test(char) && covers(last.file, cp)) {
      last.text += char
      continue
    }
    const file = files.find((f) => covers(f, cp))
    const [useFile, useText] = file ? [file, char] : [files[0], MISSING]
    if (last && last.file === useFile) last.text += useText
    else runs.push({ file: useFile, text: useText })
  }
  return runs
}

/** The characters that would print as "?" (for tests and checks). */
export function unprintable(text: string): string[] {
  return [...text].filter((char) => !Object.values(PDF_FONT_FILES).flat().some((f) => covers(f, char.codePointAt(0)!)))
}

export class PdfFonts {
  private embedded = new Map<string, Promise<PDFFont>>()

  constructor(private doc: PDFDocument) {
    doc.registerFontkit(fontkit)
  }

  private font(file: string): Promise<PDFFont> {
    let font = this.embedded.get(file)
    if (!font) {
      font = this.doc.embedFont(bytesOf(file), { subset: true })
      this.embedded.set(file, font)
    }
    return font
  }

  async widthOf(text: string, size: number, weight: FontWeight = "regular"): Promise<number> {
    let width = 0
    for (const run of fontRuns(text, weight)) width += (await this.font(run.file)).widthOfTextAtSize(run.text, size)
    return width
  }

  async draw(page: PDFPage, text: string, options: { x: number; y: number; size: number; color: RGB; weight?: FontWeight }) {
    let x = options.x
    for (const run of fontRuns(text, options.weight)) {
      const font = await this.font(run.file)
      page.drawText(run.text, { x, y: options.y, size: options.size, font, color: options.color })
      x += font.widthOfTextAtSize(run.text, options.size)
    }
  }
}
