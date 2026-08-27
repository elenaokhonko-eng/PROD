#!/usr/bin/env python3
"""GuideBuoy AI — static page assembler.

Combines components/header.html + pages-src/<page>.html + components/footer.html
into self-contained pages/<page>.html files. Edit partials or page content,
then re-run:  python3 scripts/build.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

PAGES = {
    "home":         "GuideBuoy AI — Tell it once. We'll help you carry it from here.",
    "how-it-works": "How it works — GuideBuoy AI",
    "pricing":      "Pricing — User Pack, Bank Pack, FIDReC Pack — GuideBuoy AI",
    "marketplace":  "Marketplace — human help when you need it — GuideBuoy AI",
    "resources":    "Resources — Singapore scam & dispute help — GuideBuoy AI",
    "about":        "About — GuideBuoy AI",
    "faq-contact":  "FAQ & Contact — GuideBuoy AI",
}

ACTIVE = "text-primary font-bold border-b-2 border-primary pb-1"
INACTIVE = "text-on-surface-variant font-medium hover:text-primary transition-colors duration-200"

TEMPLATE = """<!DOCTYPE html>
<html lang="en" data-sensory="steady">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>%%TITLE%%</title>
<meta name="description" content="GuideBuoy AI — Singapore's complaint helper. Tell your story once; Lumi organises it into one report you can reuse with your bank, the Police, ScamShield, and FIDReC."/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=block" rel="stylesheet"/>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<script src="../design-system/tailwind.config.js"></script>
<link rel="stylesheet" href="../design-system/tokens.css"/>
<link rel="stylesheet" href="../design-system/base.css"/>
</head>
<body class="bg-surface text-text-slate antialiased flex flex-col min-h-screen">
%%HEADER%%
<main id="main" class="max-w-7xl mx-auto px-page-margin pt-section-gap pb-section-gap w-full">
%%CONTENT%%
</main>
%%FOOTER%%
<!-- Single persistent WhatsApp entry point (never duplicate floating buttons) -->
<a href="https://wa.me/6590727915" aria-label="Chat with GuideBuoy on WhatsApp" target="_blank" rel="noopener"
   class="fixed bottom-6 right-6 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-on-primary shadow-ambient hover:bg-primary-deep transition-colors duration-200">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6" aria-hidden="true"><path d="M12.04 2a9.9 9.9 0 0 0-8.4 15.2L2 22l4.9-1.6A9.9 9.9 0 1 0 12.04 2Zm5.8 14.1c-.25.7-1.45 1.35-2 1.4-.5.05-1.15.25-3.85-.8-3.25-1.3-5.3-4.6-5.45-4.8-.15-.2-1.3-1.75-1.3-3.3 0-1.55.8-2.3 1.1-2.6.3-.3.65-.4.85-.4h.6c.2 0 .45-.05.7.55.25.6.85 2.1.95 2.25.05.15.1.35 0 .55-.1.2-.15.35-.3.5-.15.15-.3.35-.45.5-.15.15-.3.3-.15.6.15.3.7 1.15 1.5 1.85 1.05.95 1.9 1.25 2.2 1.35.3.1.45.1.6-.05.15-.15.7-.8.9-1.1.2-.3.4-.25.65-.15.25.1 1.6.75 1.9.9.3.15.5.2.55.3.05.15.05.7-.2 1.4Z"/></svg>
</a>
<script src="../design-system/mode-switcher.js"></script>
<script>
(function(){var t=document.getElementById('gb-nav-toggle'),n=document.getElementById('gb-mobile-nav');
if(t&&n){t.addEventListener('click',function(){var o=n.classList.toggle('hidden');t.setAttribute('aria-expanded',String(!o));});}})();
</script>
</body>
</html>
"""


def build() -> None:
    header = (ROOT / "components" / "header.html").read_text()
    footer = (ROOT / "components" / "footer.html").read_text()
    for name, title in PAGES.items():
        src = ROOT / "pages-src" / f"{name}.html"
        if not src.exists():
            print(f"  skip {name} (pages-src/{name}.html missing)")
            continue
        content = src.read_text()

        def active_repl(m, page=name):
            return ACTIVE if m.group(1) == page else INACTIVE

        header_p = re.sub(r"%%ACTIVE:([a-z-]+)%%", active_repl, header)
        html = (TEMPLATE
                .replace("%%TITLE%%", title)
                .replace("%%HEADER%%", header_p)
                .replace("%%CONTENT%%", content)
                .replace("%%FOOTER%%", footer))
        out = ROOT / "pages" / f"{name}.html"
        out.write_text(html)
        print(f"  built pages/{name}.html ({len(html):,} chars)")


if __name__ == "__main__":
    build()
