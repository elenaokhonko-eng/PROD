// Maintenance server for guidebuoyai.sg while the platform upgrade is in progress.
// No dependencies. Every path returns the maintenance page with HTTP 503, except
// the avatar image and the Render health check.
import { createServer } from "node:http"
import { readFileSync } from "node:fs"

const page = readFileSync(new URL("./index.html", import.meta.url))
// The asset keeps its historical .png name but is encoded as WebP.
const avatar = readFileSync(new URL("./lumi-avatar.png", import.meta.url))
const port = Number(process.env.PORT) || 10000

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname
  const headOnly = request.method === "HEAD"

  if (path === "/healthz") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" })
    response.end(headOnly ? undefined : "ok")
    return
  }

  if (path === "/maintenance/lumi-avatar.png") {
    response.writeHead(200, {
      "Content-Type": "image/webp",
      "Content-Length": avatar.length,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    })
    response.end(headOnly ? undefined : avatar)
    return
  }

  response.writeHead(503, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": page.length,
    "Retry-After": "172800",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  })
  response.end(headOnly ? undefined : page)
})

server.listen(port, () => {
  console.log(`maintenance server listening on ${port}`)
})
