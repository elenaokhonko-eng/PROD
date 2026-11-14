import { skillsIndex } from '@/lib/agents/skills'

export const dynamic = 'force-static'

export function GET() {
  return Response.json(skillsIndex())
}
