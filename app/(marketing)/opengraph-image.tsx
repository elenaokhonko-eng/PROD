import { ogImage } from '@/lib/seo/og-image'

// Brief W1 §L6: this page's link preview, with its headline.
export const alt = 'Scammed? Find out where you stand, and what to do next.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return ogImage(alt)
}
