import { PaymentsTable } from '@/components/state-machine/facts/payments-table'
import { statementLinesSentence } from '@/lib/journey/statement-lines'
import { transactionRows, type Transaction } from '@/lib/facts'

// For each statement: the file, how many of its lines look like payments, how many were read, and those payments
// (Elena, 28 Nov 2026). The person compares; nothing is blocked.
export function StatementChecks({ statements }: { statements: Array<{ name: string; lines: number; payments: Transaction[] }> }) {
  if (!statements.length) return null
  return (
    <div className="space-y-4" data-statement-checks>
      {statements.map((statement, i) => (
        <div key={i} className="space-y-2 rounded-lg border p-4 text-sm">
          <p className="break-words font-medium">{statement.name}</p>
          <p>{statementLinesSentence(statement.lines, statement.payments.length)}</p>
          <PaymentsTable rows={transactionRows(statement.payments)} />
        </div>
      ))}
    </div>
  )
}
