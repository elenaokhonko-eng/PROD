// Runs once when the Next.js server starts: the AI model health check (instrumentation-node.ts).
export async function register() {
  // The literal NEXT_RUNTIME check lets Next drop the Node-only module from the Edge runtime build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node")
  }
}
