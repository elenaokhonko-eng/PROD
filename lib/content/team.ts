// Brief W1 §G: the About page team, from this one file. Only people who have given their OK (`consent: true`) are
// shown or published as structured data. Titles, lines, photos and LinkedIn addresses come from each person; the agent
// does not write them. Photos live in public/assets/team/.

export type TeamMember = {
  name: string
  title: string
  // One line in the person's own words; empty until they supply it.
  line: string
  photo: string | null
  linkedin: string | null
  consent: boolean
  order: number
  founder?: boolean
}

export const TEAM: readonly TeamMember[] = [
  {
    name: 'Elena Okhonko',
    title: 'Founder',
    line: '',
    photo: null,
    linkedin: null,
    consent: true,
    order: 1,
    founder: true,
  },
]

export const visibleTeam = (team: readonly TeamMember[] = TEAM) =>
  team.filter((member) => member.consent).sort((a, b) => a.order - b.order)

export const FOUNDER = TEAM.find((member) => member.founder && member.consent) ?? null

// Brief W1 §G, word for word.
export const FOUNDER_NOTE =
  'I started GuideBuoy after helping friends through almost identical scam and fraud cases, one after another. I have also had to find my own way through a confusing system, and it felt stacked against the person who was harmed. GuideBuoy is my attempt to level the playing field a little.'
