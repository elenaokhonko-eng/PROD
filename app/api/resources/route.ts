import { NextResponse } from 'next/server'
import { HARBOR_RESOURCES } from '@/lib/harbor/resources'

export function GET() {
  return NextResponse.json({ resources: HARBOR_RESOURCES })
}
