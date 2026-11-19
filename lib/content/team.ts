// Brief W1 §G: the About page team, from this one file. Names, titles, lines, photos and LinkedIn addresses come from
// each person through Elena (C:\dev\guidebuoy-inputs, approved 19 Nov 2026); the agent does not write them.
// Photos live in public/assets/team/ (400 × 400).
//
// status: 'shown' — the person agreed to be shown. 'pending' — agreed in principle, not yet confirmed: the card is
// shown greyed out with "Pending finalisation", without the LinkedIn link, and the person is left out of structured
// data (Elena, 19 Nov 2026).

export type TeamMember = {
  name: string
  title: string
  line: string
  photo: string
  linkedin: string
  group: 'team' | 'adviser'
  status: 'shown' | 'pending'
  order: number
  founder?: boolean
}

export const TEAM: readonly TeamMember[] = [
  {
    name: 'Elena Okhonko',
    title: 'Founder & CEO',
    line: 'Built GuideBuoy after helping friends through near-identical scam cases; designs its AI architecture, drawing on two decades in regulated finance and enterprise data.',
    photo: '/assets/team/elena.jpg',
    linkedin: 'https://www.linkedin.com/in/elenaokhonko/',
    group: 'team',
    status: 'shown',
    order: 1,
    founder: true,
  },
  {
    name: 'Maria Baranova',
    title: 'Co-Founder, CFO & Chief Data Officer',
    line: 'Microsoft Fabric data-platform architect with a decade of BI leadership in Australia; leads GuideBuoy’s financial model and data architecture.',
    photo: '/assets/team/maria.jpg',
    linkedin: 'https://www.linkedin.com/in/maria-baranova-businessanalyst/',
    group: 'team',
    status: 'shown',
    order: 2,
  },
  {
    name: 'Stepan Kropachev',
    title: 'Co-Founder & Chief Product Officer',
    line: 'AI product lead with eight years in product management; turns dispute procedures into workflows people can follow.',
    photo: '/assets/team/stepan.jpg',
    linkedin: 'https://www.linkedin.com/in/stepan-kropachev/',
    group: 'team',
    status: 'shown',
    order: 3,
  },
  {
    name: 'Federico Folcia',
    title: 'Co-Founder, Go-to-Market & Community Partnerships',
    line: 'Serial Singapore entrepreneur, CEO of Crane (We Are Crane Pte Ltd) and co-founder of Roomorama; leads community distribution and partnerships.',
    photo: '/assets/team/federico.jpg',
    linkedin: 'https://www.linkedin.com/in/federicofolcia/',
    group: 'team',
    status: 'shown',
    order: 4,
  },
  {
    name: 'Nick (Ng Yuin Harng)',
    title: 'Government & Ecosystem Lead',
    line: 'Leads GuideBuoy’s relationships with Singapore government agencies, community organisations and partners.',
    photo: '/assets/team/nick.jpg',
    linkedin: 'https://www.linkedin.com/in/nicholasnyh/',
    group: 'team',
    status: 'shown',
    order: 5,
  },
  {
    name: 'Sergey Anosov',
    title: 'Adviser, AI Technology',
    line: 'CEO of Scade.pro, a no-code platform for building AI applications; advises GuideBuoy on AI technology and tooling.',
    photo: '/assets/team/sergey.jpg',
    linkedin: 'https://www.linkedin.com/in/sergeyanosov/',
    group: 'adviser',
    status: 'shown',
    order: 6,
  },
  {
    name: 'Greg Woolf',
    title: 'Adviser, AI Market Entry Strategy',
    line: 'AI innovator and strategist who launches and grows AI and data-analytics products in regulated industries; recognised for work on AI strategy and risk management. Advises GuideBuoy on AI market entry.',
    photo: '/assets/team/greg.jpg',
    linkedin: 'https://www.linkedin.com/in/greg-woolf-b3125/',
    group: 'adviser',
    status: 'shown',
    order: 7,
  },
  {
    name: 'Viviene Sandhu',
    title: 'Legal Adviser; Advocate & Solicitor, Clifford Law LLP',
    line: 'Advocate & Solicitor with 29 years’ practice in employment, family and negligence law; accredited mediator, arbitrator and neutral evaluator, and Pro Bono SG Ambassador. Advises GuideBuoy on the line between procedural guidance and legal advice.',
    photo: '/assets/team/viviene.jpg',
    linkedin: 'https://www.linkedin.com/in/viviene-sandhu-aab6b695/',
    group: 'adviser',
    status: 'pending',
    order: 8,
  },
]

export const PENDING_LABEL = 'Pending finalisation'

export const teamGroup = (group: TeamMember['group'], team: readonly TeamMember[] = TEAM) =>
  team.filter((member) => member.group === group).sort((a, b) => a.order - b.order)

export const FOUNDER = TEAM.find((member) => member.founder && member.status === 'shown') ?? null

// Brief W1 §G, word for word.
export const FOUNDER_NOTE =
  'I started GuideBuoy after helping friends through almost identical scam and fraud cases, one after another. I have also had to find my own way through a confusing system, and it felt stacked against the person who was harmed. GuideBuoy is my attempt to level the playing field a little.'
