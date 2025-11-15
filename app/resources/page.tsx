export default function ResourcesPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-4">
          <h1 className="text-3xl font-bold">Self-Service Resources</h1>
          <p className="text-muted-foreground">
            We’re building a library of guides to help you resolve scams, service failures, and agency escalations in one place.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm">
            <li>How to file a unified complaint and reuse it across agencies</li>
            <li>How FIDReC works and eligibility criteria</li>
            <li>Gathering and presenting your evidence effectively</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
