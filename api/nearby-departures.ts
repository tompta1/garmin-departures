import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handlePreflight, isAllowedOrigin, setCors } from './_cors.js'
import { haversineMeters, roundCoord } from '../lib/geo.js'
import { fetchDeparturesForStop } from '../lib/golemio.js'
import { fetchJmkDepartures } from '../lib/jmk.js'
import { findNearestGroups, loadStopsIndex, pickDirectionsForGroup } from '../lib/stop-index.js'
import type { IndexedStop, SupportedMode, WatchDirectionResult } from '../lib/types.js'

const MODE_TO_ROUTE_TYPE: Record<SupportedMode, number> = {
  tram: 0,
  metro: 1,
  bus: 3,
  trolleybus: 11,
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (handlePreflight(req, res)) return
  if (!isAllowedOrigin(req)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  setCors(req, res)

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const lat = parseNumber(req.query['lat'])
  const lon = parseNumber(req.query['lon'])
  if (lat === null || lon === null) {
    res.status(400).json({ error: 'lat and lon query parameters are required' })
    return
  }

  // GOLEMIO_API_KEY is only required when serving PID (Prague) stops.
  // JMK stops use the local schedule index and do not call Golemio.
  const apiKey = process.env['GOLEMIO_API_KEY'] ?? null

  const requestedModes = parseModes(req.query['modes'])
  const departuresPerDirection = clamp(parseNumber(req.query['limit']) ?? 10, 1, 10)
  const groupLimit = clamp(parseNumber(req.query['groups']) ?? 5, 1, 10)

  try {
    const index = loadStopsIndex()
    const eligibleStops = index.stops.filter(stop => stopMatchesModes(stop, requestedModes))
    const groups = findNearestGroups(eligibleStops, lat, lon, groupLimit)

    const stops = await Promise.all(
      groups.map(async group => {
        const directions = await buildDirectionResults(
          group.stops,
          group.groupName,
          lat,
          lon,
          apiKey,
          departuresPerDirection,
        )

        return {
          groupId: group.groupId,
          name: group.groupName,
          distanceMeters: Math.round(group.distanceMeters),
          directions,
        }
      }),
    )

    res.setHeader('Cache-Control', 'public, max-age=10')
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      location: { lat: roundCoord(lat), lon: roundCoord(lon) },
      modes: requestedModes,
      stops,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const missingIndex = message.includes('stops-index.json')
    res.status(missingIndex ? 500 : 502).json({
      error: missingIndex
        ? 'Stop index not found. Run `npm install` and `npm run build:stops` first.'
        : 'Failed to build nearby departures response',
      detail: message,
    })
  }
}

async function buildDirectionResults(
  groupStops: IndexedStop[],
  groupName: string,
  lat: number,
  lon: number,
  apiKey: string | null,
  departuresPerDirection: number,
): Promise<WatchDirectionResult[]> {
  const summaries = pickDirectionsForGroup(groupStops, lat, lon)

  return Promise.all(
    summaries.map(async summary => {
      const stop = groupStops.find(candidate => candidate.stopId === summary.stopId)
      if (!stop) {
        throw new Error(`Indexed stop ${summary.stopId} missing from group ${groupName}`)
      }

      let departures
      if (stop.region === 'jmk') {
        departures = fetchJmkDepartures(summary.stopId, departuresPerDirection)
      } else if (apiKey) {
        departures = await fetchDeparturesForStop(summary.stopId, apiKey, departuresPerDirection)
      } else {
        throw new Error('GOLEMIO_API_KEY not configured')
      }
      const label = summary.headsignSamples[0]
        ? `to ${summary.headsignSamples[0]}`
        : summary.platformCode
          ? `platform ${summary.platformCode}`
          : 'this direction'

      return {
        directionId: summary.directionId,
        label,
        stopId: stop.stopId,
        stopName: stop.name,
        groupName,
        platformCode: stop.platformCode,
        lat: stop.lat,
        lon: stop.lon,
        distanceMeters: Math.round(haversineMeters(lat, lon, stop.lat, stop.lon)),
        departures,
      }
    }),
  )
}

function stopMatchesModes(stop: IndexedStop, modes: SupportedMode[]): boolean {
  const allowedRouteTypes = new Set(modes.map(mode => MODE_TO_ROUTE_TYPE[mode]))
  return stop.routeTypes.some(routeType => allowedRouteTypes.has(routeType))
}

function parseModes(raw: string | string[] | undefined): SupportedMode[] {
  const allowed: SupportedMode[] = ['tram', 'metro', 'bus', 'trolleybus']
  if (!raw) return allowed

  const values = (Array.isArray(raw) ? raw.join(',') : raw)
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter((value): value is SupportedMode => allowed.includes(value as SupportedMode))

  return values.length > 0 ? [...new Set(values)] : allowed
}

function parseNumber(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
