#!/usr/bin/env tsx

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { haversineMeters } from '../lib/geo.js'
import type { IndexedStop, StopsIndexFile } from '../lib/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const GTFS_URL = 'https://data.pid.cz/PID_GTFS.zip'
const SUPPORTED_ROUTE_TYPES = new Set([0, 1, 3, 11])

type DirectionId = '0' | '1' | 'unknown'

interface StopRecord {
  stopId: string
  name: string
  lat: number
  lon: number
  parentStationId: string | null
  platformCode: string | null
  groupId: string
  groupName: string
}

interface StopAggregate {
  routeTypes: Map<number, number>
  directions: Map<DirectionId, number>
  headsigns: Map<DirectionId, Map<string, number>>
}

interface TripInfo {
  routeType: number
  directionId: DirectionId
  headsign: string
}

async function main(): Promise<void> {
  console.log('Downloading PID GTFS from', GTFS_URL)
  const response = await fetch(GTFS_URL, {
    headers: { 'User-Agent': 'garmin-departures/build-stops' },
  })

  if (!response.ok) {
    throw new Error(`Failed to download GTFS: ${response.status} ${response.statusText}`)
  }

  const zipBuffer = Buffer.from(await response.arrayBuffer())
  const zip = new AdmZip(zipBuffer)
  const read = (name: string): string => {
    const entry = zip.getEntry(name)
    if (!entry) throw new Error(`${name} not found in GTFS archive`)
    return entry.getData().toString('utf8')
  }

  console.log('Parsing stops, routes, trips and stop_times...')
  const routesById = parseRoutes(read('routes.txt'))
  const stopRecords = parseStops(read('stops.txt'))
  const tripsById = parseTrips(read('trips.txt'), routesById)
  const aggregatesByStopId = aggregateStopService(read('stop_times.txt'), tripsById, stopRecords)

  const stops: IndexedStop[] = stopRecords
    .map(stop => toIndexedStop(stop, aggregatesByStopId.get(stop.stopId)))
    .filter((stop): stop is IndexedStop => stop !== null)
    .sort((a, b) => a.groupName.localeCompare(b.groupName, 'cs'))

  const output: StopsIndexFile = {
    generatedAt: new Date().toISOString(),
    sourceUrl: GTFS_URL,
    stops,
  }

  mkdirSync(join(ROOT, 'data'), { recursive: true })
  const outputPath = join(ROOT, 'data', 'stops-index.json')
  writeFileSync(outputPath, JSON.stringify(output))
  console.log(`Wrote ${outputPath} with ${stops.length} indexed platform stops`)
}

function parseRoutes(text: string): Map<string, number> {
  const rows = parseCSV(text)
  const routeTypes = new Map<string, number>()

  for (const row of rows) {
    const routeId = row['route_id']
    const routeType = Number(row['route_type'])
    if (!routeId || !SUPPORTED_ROUTE_TYPES.has(routeType)) continue
    routeTypes.set(routeId, routeType)
  }

  return routeTypes
}

function parseTrips(text: string, routesById: Map<string, number>): Map<string, TripInfo> {
  const rows = parseCSV(text)
  const trips = new Map<string, TripInfo>()

  for (const row of rows) {
    const tripId = row['trip_id']
    const routeId = row['route_id']
    if (!tripId || !routeId) continue
    const routeType = routesById.get(routeId)
    if (routeType === undefined) continue

    trips.set(tripId, {
      routeType,
      directionId: toDirectionId(row['direction_id']),
      headsign: row['trip_headsign'] ?? '',
    })
  }

  return trips
}

function parseStops(text: string): StopRecord[] {
  const rows = parseCSV(text)
  const parentNames = new Map<string, string>()

  for (const row of rows) {
    const stopId = row['stop_id']
    const name = row['stop_name']
    if (!stopId || !name) continue
    parentNames.set(stopId, name)
  }

  const bareStops: Array<Omit<StopRecord, 'groupId' | 'groupName'>> = []
  for (const row of rows) {
    if ((row['location_type'] ?? '0') !== '0') continue

    const stopId = row['stop_id']
    const name = row['stop_name']
    const lat = Number(row['stop_lat'])
    const lon = Number(row['stop_lon'])
    if (!stopId || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue

    bareStops.push({
      stopId,
      name,
      lat,
      lon,
      parentStationId: row['parent_station'] || null,
      platformCode: row['platform_code'] || null,
    })
  }

  const byName = new Map<string, StopRecord[]>()
  const records: StopRecord[] = []

  for (const stop of bareStops) {
    if (stop.parentStationId) {
      records.push({
        ...stop,
        groupId: `parent:${stop.parentStationId}`,
        groupName: parentNames.get(stop.parentStationId) ?? stop.name,
      })
      continue
    }

    const nameKey = normalizeStopName(stop.name)
    const existing = byName.get(nameKey) ?? []
    const matched = existing.find(candidate => haversineMeters(stop.lat, stop.lon, candidate.lat, candidate.lon) <= 160)
    if (matched) {
      records.push({
        ...stop,
        groupId: matched.groupId,
        groupName: matched.groupName,
      })
      continue
    }

    const groupId = `cluster:${nameKey}:${records.length}`
    const groupName = stop.name
    const enriched: StopRecord = { ...stop, groupId, groupName }
    existing.push(enriched)
    byName.set(nameKey, existing)
    records.push(enriched)
  }

  return records
}

function aggregateStopService(
  text: string,
  tripsById: Map<string, TripInfo>,
  stops: StopRecord[],
): Map<string, StopAggregate> {
  const stopIds = new Set(stops.map(stop => stop.stopId))
  const lines = text.split('\n')
  const headers = splitCSVLine(lines[0] ?? '')
  const tripIdIndex = headers.indexOf('trip_id')
  const stopIdIndex = headers.indexOf('stop_id')
  const aggregates = new Map<string, StopAggregate>()

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]?.replace('\r', '').trim()
    if (!line) continue
    const columns = splitCSVLine(line)
    const tripId = columns[tripIdIndex]
    const stopId = columns[stopIdIndex]
    if (!tripId || !stopId || !stopIds.has(stopId)) continue

    const trip = tripsById.get(tripId)
    if (!trip) continue

    const aggregate = aggregates.get(stopId) ?? createAggregate()
    incrementCount(aggregate.routeTypes, trip.routeType)
    incrementCount(aggregate.directions, trip.directionId)
    if (trip.headsign) {
      const bucket = aggregate.headsigns.get(trip.directionId) ?? new Map<string, number>()
      incrementCount(bucket, trip.headsign)
      aggregate.headsigns.set(trip.directionId, bucket)
    }
    aggregates.set(stopId, aggregate)
  }

  return aggregates
}

function toIndexedStop(stop: StopRecord, aggregate: StopAggregate | undefined): IndexedStop | null {
  if (!aggregate) return null

  const routeTypes = [...aggregate.routeTypes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([routeType]) => routeType)

  if (routeTypes.length === 0) return null

  const dominantDirectionId = [...aggregate.directions.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'

  return {
    stopId: stop.stopId,
    name: stop.name,
    groupId: stop.groupId,
    groupName: stop.groupName,
    parentStationId: stop.parentStationId,
    lat: stop.lat,
    lon: stop.lon,
    platformCode: stop.platformCode,
    routeTypes,
    dominantDirectionId,
    headsignsByDirection: {
      '0': topHeadsigns(aggregate.headsigns.get('0')),
      '1': topHeadsigns(aggregate.headsigns.get('1')),
      unknown: topHeadsigns(aggregate.headsigns.get('unknown')),
    },
  }
}

function createAggregate(): StopAggregate {
  return {
    routeTypes: new Map<number, number>(),
    directions: new Map<DirectionId, number>(),
    headsigns: new Map<DirectionId, Map<string, number>>(),
  }
}

function topHeadsigns(bucket: Map<string, number> | undefined): string[] {
  if (!bucket) return []
  return [...bucket.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([headsign]) => headsign)
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(Boolean)
  const headers = splitCSVLine(lines[0]?.replace('\r', '') ?? '')
  const rows: Record<string, string>[] = []

  for (let index = 1; index < lines.length; index++) {
    const columns = splitCSVLine(lines[index]?.replace('\r', '') ?? '')
    const row: Record<string, string> = {}
    headers.forEach((header, columnIndex) => {
      row[header] = columns[columnIndex] ?? ''
    })
    rows.push(row)
  }

  return rows
}

function splitCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
      continue
    }

    current += char
  }

  result.push(current)
  return result
}

function incrementCount<T>(map: Map<T, number>, key: T): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function toDirectionId(value: string | undefined): DirectionId {
  if (value === '0' || value === '1') return value
  return 'unknown'
}

function normalizeStopName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
