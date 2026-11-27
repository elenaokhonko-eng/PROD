// The payments as a table, wherever they are shown (Elena, 27 Nov 2026). Every row is there; a long list scrolls
// inside its own box.

export function PaymentsTable({ rows }: { rows: Array<Record<string, string>> }) {
  if (!rows.length) return null
  const columns = Object.keys(rows[0])
  return (
    <div className="max-h-96 overflow-auto rounded-control border" data-payments-table>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted">
          <tr className="text-left">
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 font-medium">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {columns.map((column) => (
                <td key={column} className="px-3 py-1.5 align-top break-words">{row[column]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
