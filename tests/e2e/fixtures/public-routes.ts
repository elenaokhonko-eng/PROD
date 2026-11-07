export type PublicRoute = {
  path: string
  landmark: string | RegExp
  expectedPath?: string
}

export const marketingRoutes: PublicRoute[] = [
  { path: '/', landmark: /Tell us once\./ },
  { path: '/about', landmark: /The burden should sit on the system/ },
  { path: '/faq', landmark: 'Honest answers for a stressful moment.' },
  { path: '/privacy', landmark: 'Privacy Policy' },
  { path: '/resources', landmark: 'Start with the free evaluation right now if the scam just happened.' },
  { path: '/terms', landmark: 'Terms of Service' },
  { path: '/marketplace', landmark: 'Help categories being considered.' },
  { path: '/marketplace/volunteers', expectedPath: '/marketplace', landmark: 'Help categories being considered.' },
  { path: '/coming-soon', expectedPath: '/marketplace', landmark: 'Help categories being considered.' },
  { path: '/product', landmark: 'One calm place to organise what happened.' },
  { path: '/pricing', landmark: 'Free to start. Paid only when you choose more.' },
  { path: '/how-it-works', landmark: /From something went wrong to here.s my organised case\./ },
]

export const routerStaticRoutes: PublicRoute[] = [
  { path: '/router', landmark: 'Tell GuideBuoy what happened.' },
  { path: '/router/path-a2', landmark: 'Review current official guidance' },
  { path: '/router/path-e', landmark: 'Review official reporting options' },
  { path: '/router/tracker', expectedPath: '/router', landmark: 'Tell GuideBuoy what happened.' },
]
