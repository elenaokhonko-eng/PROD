// Cutover checklist, week one: a recording adds to the story already in the box and never replaces it, whichever came
// first. Each part keeps its own paragraph.
export function appendToStory(current: string, addition: string): string {
  const added = addition.trim()
  if (!added) return current
  const kept = current.trimEnd()
  return kept ? `${kept}\n\n${added}` : added
}
