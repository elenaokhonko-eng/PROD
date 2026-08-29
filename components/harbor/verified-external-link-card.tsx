import { ExternalLink } from 'lucide-react'

type VerifiedExternalLinkCardProps = {
  title: string
  description: string
  href: string
  source: string
}

export function VerifiedExternalLinkCard({ title, description, href, source }: VerifiedExternalLinkCardProps) {
  return (
    <article className="gb-card flex h-full flex-col p-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-harbor-info">
        <ExternalLink className="size-4" aria-hidden="true" />
        External website · {source}
      </div>
      <h2 className="mt-4 text-xl font-semibold text-harbor-deep">{title}</h2>
      <p className="mt-2 flex-1 leading-6 text-muted-foreground">{description}</p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full font-semibold text-primary underline-offset-4 hover:underline"
      >
        Visit {source}
        <ExternalLink className="size-4" aria-hidden="true" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </article>
  )
}
