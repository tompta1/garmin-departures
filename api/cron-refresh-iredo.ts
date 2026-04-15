/**
 * Vercel Cron endpoint — runs daily to discover all IREDO stops
 * (Pardubický + Královéhradecký kraj) and upload a stops index to Vercel Blob.
 *
 * Discovery strategy: enumerate all 2-char prefixes across the Czech alphabet
 * in parallel (concurrency-limited). Where results hit the 50-item cap, recurse
 * with 3-char (and 4-char) prefixes. Then fetch getStation for each unique ID
 * to get lat/lon, also in parallel batches.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { put } from '@vercel/blob'
import type { IndexedStop, StopsIndexFile } from '../lib/types.js'

const IREDO_BASE = 'https://iredo.online'
const RESULT_LIMIT = 50
const MAX_DEPTH = 4          // max prefix length before giving up
const FETCH_CONCURRENCY = 20 // parallel requests at once

// Bounding box for Pardubický + Královéhradecký kraj
const BOUNDS = { latMin: 49.7, latMax: 50.95, lonMin: 14.8, lonMax: 17.2 }

// Czech characters that appear at the start of stop/city names
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
    const stationMap = await discoverStationIds()
    console.log(`IREDO cron: discovered ${stationMap.size} unique station IDs`)

    const stops = await fetchStopCoordinates([...stationMap.keys()])
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

  // Build all 2-char starting prefixes
  const seedPrefixes: string[] = []
  for (const a of CHARS) {
    for (const b of CHARS) {
      seedPrefixes.push(a + b)
    }
  }

  // Fetch seeds in parallel, collect capped ones for recursion
  const cappedPrefixes: string[] = []
  await parallelMap(seedPrefixes, FETCH_CONCURRENCY, async (prefix) => {
    const results = await fetchStations(prefix)
    for (const s of results) all.set(s.id, s)
    if (results.length >= RESULT_LIMIT) cappedPrefixes.push(prefix)
  })

  // Recurse into capped 2-char prefixes → 3-char
  const cappedPrefixes3: string[] = []
  if (cappedPrefixes.length > 0) {
    const level3 = cappedPrefixes.flatMap(p => CHARS.map(c => p + c))
    await parallelMap(level3, FETCH_CONCURRENCY, async (prefix) => {
      const results = await fetchStations(prefix)
      for (const s of results) all.set(s.id, s)
      if (results.length >= RESULT_LIMIT && prefix.length < MAX_DEPTH) {
        cappedPrefixes3.push(prefix)
      }
    })
  }

  // Recurse into capped 3-char prefixes → 4-char (and 5-char if still capped)
  if (cappedPrefixes3.length > 0) {
    const level4 = cappedPrefixes3.flatMap(p => CHARS.map(c => p + c))
    const cappedPrefixes4: string[] = []
    await parallelMap(level4, FETCH_CONCURRENCY, async (prefix) => {
      const results = await fetchStations(prefix)
      for (const s of results) all.set(s.id, s)
      if (results.length >= RESULT_LIMIT) cappedPrefixes4.push(prefix)
    })
    if (cappedPrefixes4.length > 0) {
      const level5 = cappedPrefixes4.flatMap(p => CHARS.map(c => p + c))
      await parallelMap(level5, FETCH_CONCURRENCY, async (prefix) => {
        const results = await fetchStations(prefix)
        for (const s of results) all.set(s.id, s)
      })
    }
  }

  return all
}

async function fetchStations(mask: string): Promise<RawStation[]> {
  const url = `${IREDO_BASE}/oredo/findStations?mask=${encodeURIComponent(mask)}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'garmin-departures/cron-refresh-iredo' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    return await res.json() as RawStation[]
  } catch {
    return []
  }
}

// ── Coordinate fetching ───────────────────────────────────────────────────────

async function fetchStopCoordinates(ids: string[]): Promise<IndexedStop[]> {
  const stops: IndexedStop[] = []

  await parallelMap(ids, FETCH_CONCURRENCY, async (id) => {
    const detail = await fetchStation(id)
    if (!detail) return
    const stop = toIndexedStop(detail)
    if (stop) stops.push(stop)
  })

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
    return await res.json() as StationDetail
  } catch {
    return null
  }
}

function toIndexedStop(detail: StationDetail): IndexedStop | null {
  if (
    (detail.lat === 0 && detail.lon === 0) ||
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
    routeTypes: [3],
    dominantDirectionId: 'unknown',
    headsignsByDirection: { unknown: [] },
    region: 'iredo',
  }
}

/** "Pardubice,,Hlavní nádraží" → "Pardubice, Hlavní nádraží" */
function cleanName(raw: string): string {
  return raw.replace(/,,/g, ', ').replace(/,([^ ])/g, ', $1').trim()
}

// ── Utility ───────────────────────────────────────────────────────────────────

async function parallelMap<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0
  async function worker(): Promise<void> {
    while (i < items.length) {
      const item = items[i++]!
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}
