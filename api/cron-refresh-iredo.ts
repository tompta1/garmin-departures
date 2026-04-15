/**
 * Vercel Cron endpoint — runs daily to discover all IREDO stops
 * (Pardubický + Královéhradecký kraj) and upload a stops index to Vercel Blob.
 *
 * Discovery strategy: recursive findStations prefix search across the Czech
 * alphabet. When a query returns the 50-result cap, subdivide into all
 * next-character combinations until the result count drops below the cap.
 * Then fetch getStation for each unique ID to get lat/lon.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { put } from '@vercel/blob'
import type { IndexedStop, StopsIndexFile } from '../lib/types.js'

const IREDO_BASE = 'https://iredo.online'
const RESULT_LIMIT = 50
const MAX_DEPTH = 5

// Bounding box for Pardubický + Královéhradecký kraj
const BOUNDS = { latMin: 49.7, latMax: 50.95, lonMin: 14.8, lonMax: 17.2 }

// Czech alphabet characters that appear as leading chars in stop names
const CHARS = 'abcdefghijklmnopqrstuvwxyzáčďéěíňóřšťúůýž'.split('')

interface RawStation {
  id: string
  number: number
  sourceType: string
  name: string
  lat: number
  lon: number
}

interface StationDetail extends RawStation {
  zone: number
  stopPoints: Array<{ code: number; platform: string; lat: number; lon: number }> | null
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const cronSecret = process.env['CRON_SECRET']
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    console.log('IREDO cron: discovering stations...')
    const stationIds = await discoverStationIds()
    console.log(`IREDO cron: discovered ${stationIds.size} unique station IDs`)

    const stops = await fetchStopCoordinates(stationIds)
    console.log(`IREDO cron: ${stops.length} stops with valid coordinates in region`)

    const stopsIndex: StopsIndexFile = {
      generatedAt: new Date().toISOString(),
      sourceUrl: IREDO_BASE,
      stops,
    }

    await put('iredo/stops-index.json', JSON.stringify(stopsIndex), {
      access: 'public',
      addRandomSuffix: false,
    })

    res.status(200).json({
      ok: true,
      generatedAt: stopsIndex.generatedAt,
      stops: stops.length,
    })
  } catch (err) {
    console.error('IREDO cron failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}

// ── Station discovery ─────────────────────────────────────────────────────────

async function discoverStationIds(): Promise<Map<string, RawStation>> {
  const all = new Map<string, RawStation>()

  async function search(prefix: string, depth: number): Promise<void> {
    await sleep(50) // be polite
    const results = await fetchStations(prefix)
    for (const s of results) all.set(s.id, s)

    if (results.length >= RESULT_LIMIT && depth < MAX_DEPTH) {
      // Sequential to avoid overwhelming the server
      for (const c of CHARS) {
        await search(prefix + c, depth + 1)
      }
    }
  }

  // Top-level: run in small parallel batches
  for (let i = 0; i < CHARS.length; i += 5) {
    await Promise.all(CHARS.slice(i, i + 5).map(c => search(c, 1)))
  }

  return all
}

async function fetchStations(mask: string): Promise<RawStation[]> {
  const url = `${IREDO_BASE}/oredo/findStations?mask=${encodeURIComponent(mask)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'garmin-departures/cron-refresh-iredo' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return []
  return res.json() as Promise<RawStation[]>
}

// ── Coordinate fetching ───────────────────────────────────────────────────────

async function fetchStopCoordinates(stationIds: Map<string, RawStation>): Promise<IndexedStop[]> {
  const ids = [...stationIds.keys()]
  const stops: IndexedStop[] = []

  // Fetch in batches of 10 to avoid hammering the server
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10)
    const details = await Promise.all(batch.map(id => fetchStation(id)))

    for (const detail of details) {
      if (!detail) continue
      const stop = toIndexedStop(detail)
      if (stop) stops.push(stop)
    }

    if (i + 10 < ids.length) await sleep(100)
  }

  return stops
}

async function fetchStation(id: string): Promise<StationDetail | null> {
  const url = `${IREDO_BASE}/oredo/getStation?id=${encodeURIComponent(id)}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'garmin-departures/cron-refresh-iredo' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return res.json() as Promise<StationDetail>
  } catch {
    return null
  }
}

function toIndexedStop(detail: StationDetail): IndexedStop | null {
  // Filter to IREDO region bounding box; discard zero-coordinate placeholders
  if (
    detail.lat === 0 && detail.lon === 0 ||
    detail.lat < BOUNDS.latMin || detail.lat > BOUNDS.latMax ||
    detail.lon < BOUNDS.lonMin || detail.lon > BOUNDS.lonMax
  ) return null

  const name = cleanName(detail.name)

  return {
    stopId: detail.id,
    name,
    groupId: `iredo:${detail.id}`,
    groupName: name,
    parentStationId: null,
    lat: detail.lat,
    lon: detail.lon,
    platformCode: null,
    routeTypes: [3], // bus; trains are rare in this MHD context
    dominantDirectionId: 'unknown',
    headsignsByDirection: { unknown: [] },
    region: 'iredo',
  }
}

/** "Pardubice,,Hlavní nádraží" → "Pardubice, Hlavní nádraží" */
function cleanName(raw: string): string {
  return raw.replace(/,,/g, ', ').replace(/,([^ ])/g, ', $1').trim()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
