export type PublicRoute = {
  path: string
  landmark: string | RegExp
  expectedPath?: string
}

export const marketingRoutes: PublicRoute[] = [
  { path: '/', landmark: /Feeling overwhelmed by a scam or complaint/ },
  { path: '/about', landmark: /We are building Singapore's complaint OS/ },
  { path: '/faq', landmark: 'Frequently Asked Questions' },
  { path: '/privacy', landmark: 'Privacy Policy' },
  { path: '/resources', landmark: 'Stay informed and prepared' },
  { path: '/terms', landmark: 'Terms of Service' },
  { path: '/marketplace', landmark: 'Human help only when you need it' },
  { path: '/marketplace/volunteers', landmark: 'Help citizens as a nominee or volunteer' },
  { path: '/coming-soon', landmark: 'Coming Soon' },
  { path: '/analytics', landmark: 'Acquisition & engagement' },
]

export const routerStaticRoutes: PublicRoute[] = [
  { path: '/router', landmark: 'Tell us what happened with your bank or insurer' },
  { path: '/router/path-a2', landmark: 'The telco may be responsible for this scam' },
  { path: '/router/path-e', landmark: /Formal recovery is difficult/ },
  { path: '/router/tracker', landmark: '4-Week Bank Dispute Tracker' },
]
