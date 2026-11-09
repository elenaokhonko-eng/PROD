# Builds assets/fonts/noto/NotoSansSC-Regular.ttf from Google Fonts' variable Noto Sans SC (see assets/fonts/noto/README.md).
# Usage: python -I scripts/fonts/build-noto-sans-sc.py "NotoSansSC[wght].ttf" assets/fonts/noto/NotoSansSC-Regular.ttf
# Needs fontTools 4.54.1 (pip install fonttools==4.54.1).
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
# Static Regular (wght 400) of Noto Sans SC for the PDFs. Glyphs are padded to 4 bytes: @pdf-lib/fontkit copies glyph
# data as-is into subsets with short loca offsets, which need even-length glyphs.
static = instancer.instantiateVariableFont(TTFont(sys.argv[2]), {"wght": 400}, updateFontNames=True)
static["glyf"].padding = 4
static.save(sys.argv[3])
g = TTFont(sys.argv[3])
loca = g["loca"]
print("glyphs", g["maxp"].numGlyphs, "odd-length glyphs", sum(1 for i in range(len(loca) - 1) if (loca[i + 1] - loca[i]) % 2), g["name"].getDebugName(4))
