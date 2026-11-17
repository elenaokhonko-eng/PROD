import type { ReactNode } from 'react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import type { Inline, LegalDocument } from '@/lib/legal/legal-document'

const EMAIL = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/

function withEmailLinks(text: string): ReactNode[] {
  return text.split(EMAIL).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} className="underline" href={`mailto:${part}`}>
        {part}
      </a>
    ) : (
      part
    ),
  )
}

function Text({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, i) =>
        inline.bold ? <strong key={i}>{withEmailLinks(inline.text)}</strong> : <span key={i}>{withEmailLinks(inline.text)}</span>,
      )}
    </>
  )
}

function sectionAnchor(text: string): string | undefined {
  const number = /^(\d+)\.\s/.exec(text)?.[1]
  return number ? `section-${number}` : undefined
}

// Renders a document from docs/legal word for word. The page title is the document's own "# " heading, which the
// header's title must match (tests/contracts/legal-pages.test.ts).
export function LegalDocumentPage({ document }: { document: LegalDocument }) {
  return (
    <MarketingPage eyebrow="Legal" title={document.meta.title}>
      <MarketingSection className="mx-auto flex max-w-3xl flex-col gap-5 leading-7">
        {document.blocks.map((block, i) => {
          switch (block.kind) {
            case 'heading':
              return block.level === 1 ? null : (
                // A numbered section gets an anchor ("6. Products…" → #section-6) so other pages can link to a clause.
                <h2 key={i} id={sectionAnchor(block.text)} className="scroll-mt-24 pt-4 text-xl font-medium">
                  {block.text}
                </h2>
              )
            case 'paragraph':
              return (
                <p key={i}>
                  <Text inlines={block.inlines} />
                </p>
              )
            case 'list':
              return (
                <ul key={i} className="list-disc space-y-1 pl-6">
                  {block.items.map((item, j) => (
                    <li key={j}>
                      <Text inlines={item} />
                    </li>
                  ))}
                </ul>
              )
            case 'table':
              return (
                <div key={i} className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr>
                        {block.header.map((cell, j) => (
                          <th key={j} scope="col" className="border-b px-3 py-2 align-top font-medium">
                            <Text inlines={cell} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, j) => (
                        <tr key={j}>
                          {row.map((cell, k) => (
                            <td key={k} className="border-b px-3 py-2 align-top">
                              <Text inlines={cell} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          }
        })}
      </MarketingSection>
    </MarketingPage>
  )
}
