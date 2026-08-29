"use client"

export default function GlobalError() {
  return (
    <html lang="en">
      <body className="bg-[#FAF7F2] px-4 py-12 text-[#2E3A3F]">
        <main className="mx-auto max-w-md rounded-2xl border border-[#D8DDD8] bg-[#FDFCFA] p-8 text-center shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#2E6E6A]">GuideBuoy AI</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">We could not load GuideBuoy</h1>
          <p className="mt-4 text-[#5C6B70]">Please refresh the page and try again.</p>
          <button className="mt-8 min-h-11 rounded-lg bg-[#2E6E6A] px-4 py-2 font-medium text-[#FDFCFA]" onClick={() => window.location.reload()}>
            Refresh page
          </button>
        </main>
      </body>
    </html>
  )
}
