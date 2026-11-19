// The company's public details, shown in the footer and on About and published as structured data (brief W1 §L5).
// One source, so the visible page and the JSON-LD cannot drift apart.
export const COMPANY = {
  brand: 'GuideBuoy AI',
  legalName: 'GuideBuoy AI SG Pte Ltd',
  uen: '202545875C',
  address: { street: '51 Goldhill Plaza #07-10/11', postalCode: '308900', country: 'SG', display: '51 Goldhill Plaza #07-10/11, Singapore 308900' },
  mobile: { display: '+65 9072 7915', tel: '+6590727915' },
  main: { display: '+65 6690 9262', tel: '+6566909262' },
  email: 'info@guidebuoyai.sg',
  // The GuideBuoy LinkedIn company page, once Elena supplies it (§L5 sameAs).
  linkedin: null as string | null,
} as const
