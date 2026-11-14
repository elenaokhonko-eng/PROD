import { z } from 'zod'
import { DEVICE_CLASSES, FUNNEL_EVENTS } from './funnel'

// Analytics 2 (brief W1 §N): what the browser may send. Only the listed steps, and only channel fields; anything else
// in the body is dropped.
const host = z.string().max(200).regex(/^[a-z0-9.-]+$/i).nullable().optional()
const tag = z.string().max(100).nullable().optional()

export const firstTouchSchema = z.object({
  referrer_host: host,
  utm_source: tag,
  utm_medium: tag,
  utm_campaign: tag,
  device_class: z.enum(DEVICE_CLASSES).nullable().optional(),
})

export const funnelEventSchema = firstTouchSchema.extend({
  event: z.enum(FUNNEL_EVENTS),
  anon_session_id: z.string().uuid(),
  path: z.string().max(200).startsWith('/').nullable().optional(),
})

// Crawlers and monitors are not visitors; their steps are dropped. The user agent is read for this and never stored.
export const NOT_A_VISITOR = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|uptime|curl|wget|python|httpclient|axios|node-fetch|go-http|java\//i
