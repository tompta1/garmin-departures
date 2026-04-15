import { list } from '@vercel/blob'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { haversineMeters } from './geo.js'
import type { IndexedStop, StopsIndexFile, StopDirectionSummary } from './types.js'

let cachedIndex: StopsIndexFile | null = null

export async function loadStopsIndex(): Promise<StopsIndexFile> {
  if (cachedIndex) return cachedIndex

  // Always load the PID (Prague) index from the bundled file
  const pidPath = join(process.cwd(), 'data', 'stops-index.json')
  const pid = JSON.parse(readFileSync(pidPath, 'utf8')) as StopsIndexFile

  // Try to load the JMK index from Vercel Blob first (production path)
  const blobToken = process.env['BLOB_READ_WRITE_TOKEN']
  let jmkStops: IndexedStop[] = []

  if (blobToken) {
    try {
      const { blobs } = await list({ prefix: 'jmk/stops-index.json', token: blobToken })
      const blob = blobs[0]
      if (blob) {
        const res = await fetch(blob.url)
        if (res.ok) {
          const jmk = await res.json() as StopsIndexFile
          jmkStops = jmk.stops
          console.log(`JMK stops loaded from Blob: ${jmkStops.length} stops`)
        }
      }
    } catch (err) {
      console.warn('Failed to load JMK stops from Blob, trying local file:', err)
    }
  }

  // Fallback: bundled local file (local dev or first deploy before cron runs)
  if (jmkStops.length === 0) {
    const jmkPath = join(process.cwd(), 'data', 'stops-index-jmk.json')
    if (existsSync(jmkPath)) {
      const jmk = JSON.parse(readFileSync(jmkPath, 'utf8')) as StopsIndexFile
      jmkStops = jmk.stops
      console.log(`JMK stops loaded from local file: ${jmkStops.length} stops`)
    }
  }

  cachedIndex = {
    generatedAt: pid.generatedAt,
    sourceUrl: pid.sourceUrl,
    stops: [...pid.stops, ...jmkStops],
  }

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
  const byPlatform = new Map<string, IndexedStop[]>()
  for (const stop of groupStops) {
    const key = stop.platformCode ?? `__stop__${stop.stopId}`
    const bucket = byPlatform.get(key)
    if (bucket) bucket.push(stop)
    else byPlatform.set(key, [stop])
  }

  const summaries: StopDirectionSummary[] = []
  for (const platformStops of byPlatform.values()) {
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
