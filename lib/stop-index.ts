import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { haversineMeters } from './geo.js'
import type { IndexedStop, StopsIndexFile, StopDirectionSummary } from './types.js'

let cachedIndex: StopsIndexFile | null = null

export function loadStopsIndex(): StopsIndexFile {
  if (cachedIndex) return cachedIndex

  const filePath = join(process.cwd(), 'data', 'stops-index.json')
  const raw = readFileSync(filePath, 'utf8')
  cachedIndex = JSON.parse(raw) as StopsIndexFile
  return cachedIndex
}

export function findNearestGroups(
  stops: IndexedStop[],
  lat: number,
  lon: number,
  groupLimit: number,
): Array<{ groupId: string; groupName: string; distanceMeters: number; stops: IndexedStop[] }> {
  const byGroup = new Map<string, IndexedStop[]>()
  for (const stop of stops) {
    const bucket = byGroup.get(stop.groupId)
    if (bucket) bucket.push(stop)
    else byGroup.set(stop.groupId, [stop])
  }

  return [...byGroup.entries()]
    .map(([groupId, groupStops]) => ({
      groupId,
      groupName: groupStops[0]?.groupName ?? groupId,
      distanceMeters: Math.min(...groupStops.map(stop => haversineMeters(lat, lon, stop.lat, stop.lon))),
      stops: groupStops,
    }))
    .filter(group => group.distanceMeters <= 5000)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, groupLimit)
}

export function pickDirectionsForGroup(
  groupStops: IndexedStop[],
  lat: number,
  lon: number,
): StopDirectionSummary[] {
  // Each unique platform (A, B, C …) is its own tap-through direction.
  // Stops without a platform code are each treated individually by stopId.
  const byPlatform = new Map<string, IndexedStop[]>()
  for (const stop of groupStops) {
    const key = stop.platformCode ?? `__stop__${stop.stopId}`
    const bucket = byPlatform.get(key)
    if (bucket) bucket.push(stop)
    else byPlatform.set(key, [stop])
  }

  const summaries: StopDirectionSummary[] = []
  for (const platformStops of byPlatform.values()) {
    // Pick the nearest physical stop within this platform bucket.
    const stop = [...platformStops].sort(
      (a, b) => haversineMeters(lat, lon, a.lat, a.lon) - haversineMeters(lat, lon, b.lat, b.lon),
    )[0]
    if (!stop) continue

    summaries.push({
      stopId: stop.stopId,
      directionId: stop.dominantDirectionId,
      platformCode: stop.platformCode,
      headsignSamples: stop.headsignsByDirection[stop.dominantDirectionId] ?? [],
      routeTypes: stop.routeTypes,
    })
  }

  // Sort: nearest platform first, then alphabetically by platform code.
  summaries.sort((a, b) => {
    const stopA = groupStops.find(s => s.stopId === a.stopId)!
    const stopB = groupStops.find(s => s.stopId === b.stopId)!
    const distDiff =
      haversineMeters(lat, lon, stopA.lat, stopA.lon) -
      haversineMeters(lat, lon, stopB.lat, stopB.lon)
    if (Math.abs(distDiff) > 10) return distDiff
    return (a.platformCode ?? '').localeCompare(b.platformCode ?? '')
  })

  return summaries.slice(0, 6)
}
