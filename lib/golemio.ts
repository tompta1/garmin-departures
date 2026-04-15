import type { WatchDeparture } from './types.js'

const GOLEMIO_URL = 'https://api.golemio.cz/v2/pid/departureboards'
const UPSTREAM_TIMEOUT_MS = 8_000

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function fetchDeparturesForStop(
  stopId: string,
  apiKey: string,
  limit: number,
): Promise<WatchDeparture[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  const params = new URLSearchParams()
  // Golemio accepts GTFS stop/platform identifiers under the `ids` query key.
  params.append('ids', stopId)
  params.append('minutesBefore', '0')
  params.append('minutesAfter', '60')
  params.append('mode', 'departures')
  params.append('limit', String(limit))

  try {
    const response = await fetch(`${GOLEMIO_URL}?${params.toString()}`, {
      headers: {
        'X-Access-Token': apiKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Upstream error: ${response.status}`)
    }

    const payload = (await response.json()) as { departures?: unknown[] }
    const departures = Array.isArray(payload.departures) ? payload.departures : []

    return departures
      .map(raw => normalizeDeparture(raw))
      .filter((departure): departure is WatchDeparture => departure !== null)
      .sort((a, b) => a.minutes - b.minutes)
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeDeparture(raw: unknown): WatchDeparture | null {
  if (typeof raw !== 'object' || raw === null) return null

  const departure = raw as {
    departure_timestamp?: { scheduled?: unknown; predicted?: unknown }
    delay?: { seconds?: unknown } | null
    route?: { short_name?: unknown; type?: unknown }
    trip?: { headsign?: unknown }
  }

  const predictedAt = asString(departure.departure_timestamp?.predicted)
  const scheduledAt = asString(departure.departure_timestamp?.scheduled)
  const line = asString(departure.route?.short_name)
  const headsign = asString(departure.trip?.headsign)

  if (!predictedAt || !scheduledAt || !line) return null

  const predictedDate = new Date(predictedAt)
  const minutes = Math.max(0, Math.round((predictedDate.getTime() - Date.now()) / 60_000))

  return {
    line,
    headsign,
    predictedAt,
    scheduledAt,
    delaySec: asNumber(departure.delay?.seconds) ?? 0,
    minutes,
    routeType: asNumber(departure.route?.type),
  }
}
