/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Retired routes. Declared here rather than with redirect() in a page, because Next 14.2 serves a prerendered
  // page's cached redirect as a 307 without its Location header.
  async redirects() {
    return [
      { source: '/coming-soon', destination: '/marketplace', permanent: false },
      { source: '/marketplace/volunteers', destination: '/marketplace', permanent: false },
    ]
  },
}

export default nextConfig
