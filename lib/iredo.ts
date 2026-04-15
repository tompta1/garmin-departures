/**
 * Live departure fetcher for IREDO (Pardubický + Královéhradecký kraj).
 * Uses the crws/departures endpoint which returns real-time delay data.
 * No pre-built schedule needed — every request is live.
 */
import type { WatchDeparture } from './types.js'

const IREDO_BASE = 'https://iredo.online'

interface IredoDeparture {
  id: string
  destStation: string
  depTime: string          // Prague local time, no timezone: "2026-04-15T14:07:00"
  vehicleType: string      // "A" = bus/coach, "V" = train, "S" = other
  lineNumber: number
  extLineName: string | null
  serviceNumber: number
  delay: number            // minutes (positive = late, negative = early)
  platform: string | null
}

export async function fetchIredoDepartures(stopId: string, limit: number): Promise<WatchDeparture[]> {
  const url = `${IREDO_BASE}/crws/departures/${encodeURIComponent(stopId)}?maxCount=${limit * 2}&langId=1`

  let raw: IredoDeparture[]
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'garmin-departures/iredo' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return []
    raw = await res.json() as IredoDeparture[]
  } catch {
    return []
  }

  const now = new Date()
  const nowMs = now.getTime()

  // depTime is Prague local time with no timezone indicator.
  // On Vercel servers (UTC), new Date("2026-04-15T14:15:00") is parsed as UTC,
  // but the value represents Prague local time (UTC+1 or UTC+2 depending on DST).
  // Compute the offset by comparing UTC epoch to the Prague-local string of now.
  const pragueOffsetMs = nowMs - new Date(
    now.toLocaleString('sv-SE', { timeZone: 'Europe/Prague' }).replace(' ', 'T'),
  ).getTime()

  const results: WatchDeparture[] = []

  for (const dep of raw) {
    // Apply timezone correction: treat depTime as Prague local, convert to UTC ms
    const scheduledMs = new Date(dep.depTime).getTime() + pragueOffsetMs
    const actualMs = scheduledMs + (dep.delay ?? 0) * 60_000
    const minutes = Math.round((actualMs - nowMs) / 60_000)

    // Skip already-departed and beyond 60 min
    if (minutes < 0 || minutes > 60) continue

    results.push({
      line: lineName(dep),
      headsign: cleanDestination(dep.destStation),
      predictedAt: new Date(actualMs).toISOString(),
      scheduledAt: new Date(scheduledMs).toISOString(),
      delaySec: (dep.delay ?? 0) * 60,
      minutes,
      routeType: vehicleToRouteType(dep.vehicleType),
    })

    if (results.length >= limit) break
  }

  return results.sort((a, b) => a.minutes - b.minutes)
}

/** "Rychnov n.Kněž.,,nemocnice" → "Rychnov n.Kněž., nemocnice" */
function cleanDestination(raw: string): string {
  return raw.replace(/,,/g, ', ').replace(/,([^ ])/g, ', $1').trim()
}

/** Best human-readable line number from a departure record */
function lineName(dep: IredoDeparture): string {
  if (dep.extLineName) return dep.extLineName
  if (dep.vehicleType === 'V') return dep.serviceNumber?.toString() ?? dep.lineNumber.toString()
  return dep.lineNumber.toString()
}

function vehicleToRouteType(vehicleType: string): number {
  switch (vehicleType) {
    case 'V': return 2  // rail
    default:  return 3  // bus / coach
  }
}
