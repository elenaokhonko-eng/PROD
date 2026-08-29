import { notFound } from 'next/navigation'
import { HarborVisualFixture } from '@/components/harbor/visual-fixture'
import { findHarborVisualFixture } from '@/lib/harbor/visual-fixtures'

export const dynamic = 'force-dynamic'

export default function HarborFixturesPage({ searchParams }: { searchParams: { state?: string } }) {
  if (process.env.NODE_ENV === 'production') notFound()

  return <HarborVisualFixture fixture={findHarborVisualFixture(searchParams.state)} />
}
