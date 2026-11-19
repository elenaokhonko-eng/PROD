import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

// Brief W1 §L6: a 1200 × 630 link-preview image per page, with the page's headline on the Harbor background and the
// small mascot. No text smaller than 40 px. Built when the page is built; nothing is fetched at request time.
export const OG_IMAGE_SIZE = { width: 1200, height: 630 }

const COLORS = { background: '#e3ebf0', headline: '#245854', text: '#2e3a3f', rule: '#2e6e6a' }

export async function ogImage(headline: string) {
  const mascot = await readFile(join(process.cwd(), 'public/assets/harbor/lumi-buoy.jpg'))
  const mascotSrc = `data:image/jpeg;base64,${mascot.toString('base64')}`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: COLORS.background,
          color: COLORS.text,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mascotSrc} width={96} height={96} alt="" style={{ borderRadius: 48 }} />
          <div style={{ fontSize: 40, fontWeight: 600, color: COLORS.rule }}>GuideBuoy AI</div>
        </div>
        <div style={{ display: 'flex', fontSize: headline.length > 60 ? 60 : 72, fontWeight: 700, lineHeight: 1.12, color: COLORS.headline }}>
          {headline}
        </div>
        <div style={{ fontSize: 40, color: COLORS.text }}>guidebuoyai.sg</div>
      </div>
    ),
    OG_IMAGE_SIZE,
  )
}
