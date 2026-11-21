// Ad platforms add a click id to the landing address (gclid and friends for Google Ads). It identifies one click on one
// ad, so it is never stored: the funnel only notes that the visit came from Google Ads, and page addresses are saved
// without it.

export const CLICK_ID_PARAMS = ['gclid', 'gbraid', 'wbraid', 'gclsrc', 'dclid', 'msclkid', 'fbclid'] as const
const GOOGLE_ADS_PARAMS = ['gclid', 'gbraid', 'wbraid']

/** The channel name for a landing that carries a Google Ads click id and no utm_source of its own. */
export const GOOGLE_ADS_SOURCE = 'google-ads'

export function adClickSource(params: URLSearchParams): string | null {
  return GOOGLE_ADS_PARAMS.some((name) => params.has(name)) ? GOOGLE_ADS_SOURCE : null
}

/** The address without click ids; anything that is not an address is returned unchanged. */
export function withoutClickIds(address: string | null | undefined): string | null {
  if (!address) return address ?? null
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return address
  }
  if (!CLICK_ID_PARAMS.some((name) => url.searchParams.has(name))) return address
  for (const name of CLICK_ID_PARAMS) url.searchParams.delete(name)
  return url.toString()
}
