// The sentence above each statement's payments on the confirm screen (approved by Elena, 28 Nov 2026). The numbers
// are always counted; nothing is fixed in the text.
export function statementLinesSentence(lines: number, payments: number): string {
  return `This statement has ${lines} ${lines === 1 ? 'line' : 'lines'} with a date and an amount. ${payments} ${payments === 1 ? 'payment was' : 'payments were'} read from it. Please check the table below.`
}
