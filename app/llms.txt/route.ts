import { paidStagesState } from '@/lib/billing/paid-stages'
import { PRODUCT_CATALOGUE } from '@/lib/payments/product-catalogue'
import { SITE_ORIGIN } from '@/lib/seo/indexing'
import { readMarkdownManifest } from '@/lib/seo/markdown-files'
import { MARKDOWN_COPIES } from '@/lib/seo/public-routes.mjs'

// Reads the markdown copies the build wrote after the pages were prerendered.
export const dynamic = 'force-dynamic'

// Brief W1 §L8: a plain-text summary for AI assistants, built from the same sources as the pages. No claims beyond
// the site.
export async function GET() {
  const manifest = await readMarkdownManifest()
  const paidLive = paidStagesState().enabled
  const pack = (name: string, amount: number, what: string) =>
    `- ${name}, S$${amount}, one-off${paidLive ? '' : ' (coming shortly)'}: ${what}`
  const body = [
    '# GuideBuoy AI',
    '',
    '> A guided way to prepare your own case. It is automated and is not legal advice; you check everything before you send it.',
    '',
    'GuideBuoy is for anyone aged 18 or over, living in Singapore and acting for themselves, who has lost money to a scam or has a dispute with a bank or payment provider. GuideBuoy AI SG Pte Ltd, UEN 202545875C.',
    '',
    '## Products',
    '',
    '- Free evaluation, S$0: your facts in order, how Singapore\u2019s scam rules may apply to your case, and a suggested next step.',
    pack('Bank dispute pack', PRODUCT_CATALOGUE.self_serve_report.amountSgd, 'a concise, formal complaint to your bank with your key facts and evidence.'),
    pack(
      'FIDReC escalation pack',
      PRODUCT_CATALOGUE.fidrec_tier2_pack.amountSgd,
      'a comprehensive case pack for FIDReC\u2019s process, with every material fact, the arguments on both sides and your evidence index. You do not need the bank pack first.',
    ),
    '',
    'No one can promise you will get your money back. Your bank decides first, and FIDReC can review the bank\u2019s decision.',
    '',
    // Addendum M §M5: each page's markdown copy, with one line on what it covers.
    '## Pages',
    '',
    ...MARKDOWN_COPIES.map((copy) => {
      const description = manifest.find((entry) => entry.name === copy.name)?.description
      return `- [${copy.label}](${SITE_ORIGIN}/${copy.name}.md)${description ? `: ${description}` : ''}`
    }),
    '',
    `All pages in one file: ${SITE_ORIGIN}/llms-full.txt`,
    '',
  ].join('\n')
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
