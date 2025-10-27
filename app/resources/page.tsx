export default function ResourcesPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-4">
          <h1 className="text-3xl font-bold">Self-Service Resources</h1>
          <p className="text-muted-foreground">
            We’re building a library of guides to help you resolve common issues with banks and insurers.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm">
            <li>How to file a complaint with your bank/insurer</li>
            <li>How FIDReC works and eligibility criteria</li>
            <li>Gathering and presenting your evidence effectively</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

