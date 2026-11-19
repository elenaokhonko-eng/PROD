import { writeFile } from 'node:fs/promises'
import { ogImage } from '../lib/seo/og-image'

// Brief W1 §L6: renders each public page's 1200 × 630 link-preview image into its page folder as a static
// opengraph-image.png, with its alt text (the page headline) beside it. Next.js serves them as the page's og:image.
// Static files because next/og cannot load its fonts on Windows in Next 14, and CI builds on Windows.
// Run under Linux (WSL) after a headline changes:  pnpm exec tsx scripts/render-og-images.tsx
export const OG_PAGES: Record<string, string> = {
  '': 'Scammed? Find out where you stand, and what to do next.',
  'how-it-works/': 'From something went wrong to here’s my organised case.',
  'pricing/': 'Free to start. Paid only when you choose more.',
  'resources/': 'Scam just happened? Call your bank first.',
  'about/': 'The burden should sit on the system, not the person who was harmed.',
  'faq/': 'Honest answers for a stressful moment.',
  'marketplace/': 'Help categories being considered.',
  'terms/': 'Terms of Service',
  'privacy/': 'Privacy Policy',
  'sample/evaluation/': 'A sample free evaluation',
}

async function main() {
  for (const [dir, headline] of Object.entries(OG_PAGES)) {
    const png = new Uint8Array(await (await ogImage(headline)).arrayBuffer())
    await writeFile(`app/(marketing)/${dir}opengraph-image.png`, png)
    await writeFile(`app/(marketing)/${dir}opengraph-image.alt.txt`, headline)
    console.log(`${dir || '/'}: ${png.length} bytes`)
  }
}

if (process.argv[1]?.endsWith('render-og-images.tsx')) void main()
