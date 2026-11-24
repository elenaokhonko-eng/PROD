// IP address parsing for the location lookup (brief v5, 3c). Plain TypeScript for Deno and Node; no network access.

export interface ParsedIp {
  version: 4 | 6;
  /** The address as a number: 32 bits for IPv4, 128 bits for IPv6. IPv4-mapped IPv6 addresses are read as IPv4. */
  value: bigint;
  /** The address written canonically (dotted IPv4, lower-case IPv6 as given). */
  text: string;
}

const IPV4_PART = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function parseIpv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4 || !parts.every((p) => IPV4_PART.test(p))) return null;
  return parts.reduce((acc, p) => (acc << BigInt(8)) | BigInt(Number(p)), BigInt(0));
}

function parseIpv6(text: string): bigint | null {
  let input = text.toLowerCase();
  // An embedded IPv4 tail (::ffff:192.0.2.1) becomes two hextets.
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(input);
  if (tail) {
    const v4 = parseIpv4(tail[1]);
    if (v4 === null) return null;
    input = `${input.slice(0, -tail[1].length)}${(v4 >> BigInt(16)).toString(16)}:${(v4 & BigInt(0xffff)).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.reduce((acc, g) => (acc << BigInt(16)) | BigInt(parseInt(g, 16)), BigInt(0));
}

const V4_MAPPED_PREFIX = BigInt(0xffff) << BigInt(32);

export function parseIp(input: string): ParsedIp | null {
  const text = input.trim();
  if (!text) return null;
  if (!text.includes(":")) {
    const value = parseIpv4(text);
    return value === null ? null : { version: 4, value, text };
  }
  const value = parseIpv6(text);
  if (value === null) return null;
  if (value >> BigInt(32) === V4_MAPPED_PREFIX >> BigInt(32)) {
    const v4 = value & BigInt(0xffffffff);
    return { version: 4, value: v4, text: formatIpv4(v4) };
  }
  return { version: 6, value, text: text.toLowerCase() };
}

export function formatIpv4(value: bigint): string {
  return [BigInt(24), BigInt(16), BigInt(8), BigInt(0)].map((shift) => String((value >> shift) & BigInt(0xff))).join(".");
}

interface Block {
  version: 4 | 6;
  start: bigint;
  bits: number;
}

function cidr(text: string): Block {
  const [address, length] = text.split("/");
  const ip = parseIp(address)!;
  const width = ip.version === 4 ? 32 : 128;
  return { version: ip.version, start: ip.value, bits: width - Number(length) };
}

// Networks no outside database can place: private, loopback, link-local, shared address space, unique-local.
// The documentation ranges (RFC 5737, RFC 3849) are deliberately not listed: the synthetic test databases use them,
// and a real database holds no rows for them.
const NOT_PUBLIC: Block[] = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "::/127",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
].map(cidr);

/** True for an address no outside database can place (a private network, the device itself, multicast). */
export function isNotPublic(ip: ParsedIp): boolean {
  return NOT_PUBLIC.some((b) => b.version === ip.version && ip.value >> BigInt(b.bits) === b.start >> BigInt(b.bits));
}
