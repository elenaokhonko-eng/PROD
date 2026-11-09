// Cloudflare's published edge ranges (https://www.cloudflare.com/ips-v4 and /ips-v6, fetched 9 Nov 2026). Used to
// decide whether a request really reached Render through Cloudflare before its CF-Connecting-IP is believed
// (Elena, 9 Nov). Re-check the lists when Cloudflare announces a change; tests/contracts/client-ip.test.ts pins them.
export const CLOUDFLARE_IP_RANGES_FETCHED = "2026-11-09"

export const CLOUDFLARE_IPV4_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const

export const CLOUDFLARE_IPV6_RANGES = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
] as const

export type ParsedIp = { version: 4 | 6; value: bigint }

function parseIpv4(text: string): bigint | null {
  const parts = text.split(".")
  if (parts.length !== 4) return null
  let value = BigInt(0)
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null
    value = (value << BigInt(8)) | BigInt(Number(part))
  }
  return value
}

function parseIpv6(input: string): bigint | null {
  let text = input
  // An embedded IPv4 tail (for example ::ffff:192.0.2.1) is the last two groups.
  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":")
    const v4 = parseIpv4(text.slice(lastColon + 1))
    if (v4 === null) return null
    text = `${text.slice(0, lastColon + 1)}${(v4 >> BigInt(16)).toString(16)}:${(v4 & BigInt(0xffff)).toString(16)}`
  }
  if (!/^[0-9a-f:]+$/i.test(text)) return null
  const halves = text.split("::")
  if (halves.length > 2) return null
  const groups = (side: string) => (side === "" ? [] : side.split(":"))
  const left = groups(halves[0])
  const right = halves.length === 2 ? groups(halves[1]) : []
  if ([...left, ...right].some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null
  const missing = 8 - left.length - right.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  return [...left, ...Array<string>(missing).fill("0"), ...right].reduce((acc, g) => (acc << BigInt(16)) | BigInt(parseInt(g, 16)), BigInt(0))
}

export function parseIp(text: string): ParsedIp | null {
  const trimmed = text.trim().replace(/^\[|\]$/g, "")
  const v4 = parseIpv4(trimmed)
  if (v4 !== null) return { version: 4, value: v4 }
  const v6 = parseIpv6(trimmed)
  if (v6 === null) return null
  // IPv4-mapped (::ffff:a.b.c.d) is the IPv4 address.
  if (v6 >> BigInt(32) === BigInt(0xffff)) return { version: 4, value: v6 & BigInt(0xffffffff) }
  return { version: 6, value: v6 }
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/")
  const address = parseIp(ip)
  const network = parseIp(base)
  if (!address || !network || address.version !== network.version) return false
  const width = address.version === 4 ? 32 : 128
  const bits = Number(bitsText)
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return false
  const shift = BigInt(width - bits)
  return address.value >> shift === network.value >> shift
}

export function isCloudflareIp(ip: string): boolean {
  return [...CLOUDFLARE_IPV4_RANGES, ...CLOUDFLARE_IPV6_RANGES].some((cidr) => ipInCidr(ip, cidr))
}
