# Noto fonts for the PDFs

Used by `lib/server/pdf-fonts.ts` so the free-evaluation PDF prints names and symbols as written (Chinese, Tamil,
Latin with "·" and curly quotes). All are SIL Open Font License 1.1 (`OFL.txt`); fonts are subset into each PDF.

| File | Source | SHA-256 |
|---|---|---|
| NotoSans-Regular.ttf | notofonts/notofonts.github.io `fonts/NotoSans/hinted/ttf/` | 478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823 |
| NotoSans-Bold.ttf | same | 1df075a380fc7cb898acf64c1f7b3b4dd780de3caa860178bf929de35817a913 |
| NotoSansTamil-Regular.ttf | notofonts/notofonts.github.io `fonts/NotoSansTamil/hinted/ttf/` | 3c0a186feb3c63c7f6d63e1511dcdc144e745ae09b98e217c83f3e317974f6f9 |
| NotoSansTamil-Bold.ttf | same | 683682d585698b8b44da066d4903762d8aaa471bdffb919ac869753689ba3950 |
| NotoSansSC-Regular.ttf | built from google/fonts `ofl/notosanssc/NotoSansSC[wght].ttf` (SHA-256 a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da) with `scripts/fonts/build-noto-sans-sc.py` | c78dfffda2625f2605629f4ea1844ec88f5360644055c4c55866a1ac5783220a |

Fetched 9 November 2026. The Chinese face is a static Regular instance with glyphs padded to 4 bytes: the published
`.otf` (CFF outlines) and an unpadded instance both produce broken subsets in `@pdf-lib/fontkit` 1.1.1.
`tests/contracts/pdf-unicode.test.ts` checks that every glyph in an embedded subset has its outline.
