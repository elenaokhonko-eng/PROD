import { fidrecRouteFromFacts, type SnapshotFacts } from "../facts"
import type { ProductReadiness } from "./product-readiness"

// One FIDReC check for the offer and the generator (Elena, 27 Nov 2026: a paid pack was refused). The database decides
// from the typed route answer; where the person has confirmed facts since giving that answer, the offer also has to
// pass the generator's own check on them, so it never sells what the generator would refuse on the same facts.
// A newer typed answer is newer information: the confirm step after payment puts any conflict to the person.
export function agreeWithGenerator(
  readiness: ProductReadiness,
  snapshot: { facts: SnapshotFacts; confirmedAt: string } | null,
  routeAnsweredAt: string | null,
  today: string,
): ProductReadiness {
  if (!readiness.ready || !snapshot) return readiness
  if (routeAnsweredAt && Date.parse(routeAnsweredAt) > Date.parse(snapshot.confirmedAt)) return readiness
  const route = fidrecRouteFromFacts(snapshot.facts, today)
  if (!("reason" in route)) return readiness
  return route.reason === "fidrec_too_early" && "availableFrom" in route && route.availableFrom
    ? { ready: false, reason: route.reason, opensOn: route.availableFrom }
    : { ready: false, reason: route.reason }
}
