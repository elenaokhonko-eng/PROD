import type { MetadataRoute } from 'next'
import { INDEXABLE_ROUTES, SITE_ORIGIN } from '@/lib/seo/indexing'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return INDEXABLE_ROUTES.map((path) => ({ url: `${SITE_ORIGIN}${path === '/' ? '' : path}`, lastModified }))
}
