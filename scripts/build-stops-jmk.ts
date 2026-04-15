#!/usr/bin/env tsx

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { haversineMeters } from '../lib/geo.js'
import type { IndexedStop, StopsIndexFile } from '../lib/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const GTFS_STATIC_URL = 'https://kordis-jmk.cz/gtfs/gtfs.zip'
const SUPPORTED_ROUTE_TYPES = new Set([0, 1, 3, 11])

type DirectionId = '0' | '1' | 'unknown'

// Schedule entry stored per stop: [serviceId, departureSecs, line, headsign, routeType]
type ScheduleEntry = [number, number, string, string, number]

interface JmkSchedule {
  generatedAt: string
  // service_id (as string key) → [mon,tue,wed,thu,fri,sat,sun,start_date,end_date]
  calendar: Record<string, [number, number, number, number, number, number, number, string, string]>
  // service_id → date (YYYYMMDD) → exception_type (1=added, 2=removed)
  calendarDates: Record<string, Record<string, number>>
  // stop_id → sorted schedule entries
  stops: Record<string, ScheduleEntry[]>
}

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
  serviceId: number
  routeType: number
  routeShortName: string
  directionId: DirectionId
  headsign: string
}

async function main(): Promise<void> {
  console.log('Downloading JMK GTFS from', GTFS_STATIC_URL)
  const response = await fetch(GTFS_STATIC_URL, {
    headers: { 'User-Agent': 'garmin-departures/build-stops-jmk' },
  })
  if (!response.ok) {
    throw new Error(`Failed to download GTFS: ${response.status} ${response.statusText}`)
  }

  const zipBuffer = Buffer.from(await response.arrayBuffer())
  const zip = new AdmZip(zipBuffer)
  const read = (name: string): string => {
    const entry = zip.getEntry(name)
    if (!entry) throw new Error(`${name} not found in JMK GTFS archive`)
    // Strip UTF-8 BOM if present (JMK files are encoded with BOM)
    const text = entry.getData().toString('utf8')
    return text.startsWith('\uFEFF') ? text.slice(1) : text
  }

  console.log('Parsing routes, trips, calendar, stops, stop_times...')

  // route_id → { short_name, route_type }
  const routeInfo = parseRoutes(read('routes.txt'))

  // service_id → calendar row
  const calendarRows = parseCalendar(read('calendar.txt'))
  const calendarDatesRows = parseCalendarDates(read('calendar_dates.txt'))

  // trip_id → TripInfo
  const tripsById = parseTrips(read('trips.txt'), routeInfo)

  const stopRecords = parseStops(read('stops.txt'))

  // Aggregate stop service stats AND collect per-stop schedule entries
  const { aggregates, schedule } = aggregateStopService(
    read('stop_times.txt'),
    tripsById,
    stopRecords,
  )

  const stops: IndexedStop[] = stopRecords
    .map(stop => toIndexedStop(stop, aggregates.get(stop.stopId)))
    .filter((stop): stop is IndexedStop => stop !== null)
    .sort((a, b) => a.groupName.localeCompare(b.groupName, 'cs'))

  mkdirSync(join(ROOT, 'data'), { recursive: true })

  // Write stop index
  const stopsIndex: StopsIndexFile = {
    generatedAt: new Date().toISOString(),
    sourceUrl: GTFS_STATIC_URL,
    stops,
  }
  const stopsPath = join(ROOT, 'data', 'stops-index-jmk.json')
  writeFileSync(stopsPath, JSON.stringify(stopsIndex))
  console.log(`Wrote ${stopsPath} with ${stops.length} indexed platform stops`)

  // Write schedule index
  const jmkSchedule: JmkSchedule = {
    generatedAt: new Date().toISOString(),
    calendar: calendarRows,
    calendarDates: calendarDatesRows,
    stops: schedule,
  }
  const schedulePath = join(ROOT, 'data', 'jmk-schedule.json')
  writeFileSync(schedulePath, JSON.stringify(jmkSchedule))
  const scheduleStops = Object.keys(schedule).length
  const scheduleEntries = Object.values(schedule).reduce((n, arr) => n + arr.length, 0)
  console.log(
    `Wrote ${schedulePath} — ${scheduleStops} stops, ${scheduleEntries.toLocaleString()} departure entries`,
  )
}

function parseRoutes(text: string): Map<string, { shortName: string; routeType: number }> {
  const rows = parseCSV(text)
  const result = new Map<string, { shortName: string; routeType: number }>()
  for (const row of rows) {
    const routeId = row['route_id']
    const routeType = Number(row['route_type'])
    const shortName = row['route_short_name'] ?? ''
    if (!routeId || !SUPPORTED_ROUTE_TYPES.has(routeType)) continue
    result.set(routeId, { shortName, routeType })
  }
  return result
}

function parseCalendar(
  text: string,
): Record<string, [number, number, number, number, number, number, number, string, string]> {
  const rows = parseCSV(text)
  const result: Record<
    string,
    [number, number, number, number, number, number, number, string, string]
  > = {}
  for (const row of rows) {
    const sid = row['service_id']
    if (!sid) continue
    result[sid] = [
      Number(row['monday'] ?? 0),
      Number(row['tuesday'] ?? 0),
      Number(row['wednesday'] ?? 0),
      Number(row['thursday'] ?? 0),
      Number(row['friday'] ?? 0),
      Number(row['saturday'] ?? 0),
      Number(row['sunday'] ?? 0),
      row['start_date'] ?? '',
      row['end_date'] ?? '',
    ]
  }
  return result
}

function parseCalendarDates(text: string): Record<string, Record<string, number>> {
  const rows = parseCSV(text)
  const result: Record<string, Record<string, number>> = {}
  for (const row of rows) {
    const sid = row['service_id']
    const date = row['date']
    const type = Number(row['exception_type'])
    if (!sid || !date || !type) continue
    result[sid] ??= {}
    result[sid][date] = type
  }
  return result
}

function parseTrips(
  text: string,
  routeInfo: Map<string, { shortName: string; routeType: number }>,
): Map<string, TripInfo> {
  const rows = parseCSV(text)
  const trips = new Map<string, TripInfo>()
  for (const row of rows) {
    const tripId = row['trip_id']
    const routeId = row['route_id']
    const serviceId = Number(row['service_id'])
    if (!tripId || !routeId || !serviceId) continue
    const route = routeInfo.get(routeId)
    if (!route) continue
    trips.set(tripId, {
      serviceId,
      routeType: route.routeType,
      routeShortName: route.shortName,
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
    const matched = existing.find(
      candidate => haversineMeters(stop.lat, stop.lon, candidate.lat, candidate.lon) <= 160,
    )
    if (matched) {
      records.push({ ...stop, groupId: matched.groupId, groupName: matched.groupName })
      continue
    }
    const groupId = `jmk:${nameKey}:${records.length}`
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
): { aggregates: Map<string, StopAggregate>; schedule: Record<string, ScheduleEntry[]> } {
  const stopIds = new Set(stops.map(s => s.stopId))
  const lines = text.split('\n')
  const headers = splitCSVLine(lines[0] ?? '')
  const tripIdIdx = headers.indexOf('trip_id')
  const stopIdIdx = headers.indexOf('stop_id')
  const departureIdx = headers.indexOf('departure_time')

  const aggregates = new Map<string, StopAggregate>()
  const schedule: Record<string, ScheduleEntry[]> = {}

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.replace('\r', '').trim()
    if (!line) continue
    const cols = splitCSVLine(line)
    const tripId = cols[tripIdIdx]
    const stopId = cols[stopIdIdx]
    const departureStr = cols[departureIdx]
    if (!tripId || !stopId || !departureStr || !stopIds.has(stopId)) continue

    const trip = tripsById.get(tripId)
    if (!trip) continue

    // Aggregate for stop index metadata
    const agg = aggregates.get(stopId) ?? createAggregate()
    incrementCount(agg.routeTypes, trip.routeType)
    incrementCount(agg.directions, trip.directionId)
    if (trip.headsign) {
      const bucket = agg.headsigns.get(trip.directionId) ?? new Map<string, number>()
      incrementCount(bucket, trip.headsign)
      agg.headsigns.set(trip.directionId, bucket)
    }
    aggregates.set(stopId, agg)

    // Build schedule entry
    const secs = parseTimeSecs(departureStr)
    if (secs === null) continue
    schedule[stopId] ??= []
    schedule[stopId].push([trip.serviceId, secs, trip.routeShortName, trip.headsign, trip.routeType])
  }

  // Sort each stop's schedule by departure time
  for (const entries of Object.values(schedule)) {
    entries.sort((a, b) => a[1] - b[1])
  }

  return { aggregates, schedule }
}

function parseTimeSecs(timeStr: string): number | null {
  // GTFS time: HH:MM:SS — hours can exceed 24 for after-midnight trips
  const parts = timeStr.split(':')
  if (parts.length !== 3) return null
  const h = Number(parts[0])
  const m = Number(parts[1])
  const s = Number(parts[2])
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null
  return h * 3600 + m * 60 + s
}

function toIndexedStop(stop: StopRecord, aggregate: StopAggregate | undefined): IndexedStop | null {
  if (!aggregate) return null
  const routeTypes = [...aggregate.routeTypes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rt]) => rt)
  if (routeTypes.length === 0) return null
  const dominantDirectionId =
    [...aggregate.directions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
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
    region: 'jmk',
  }
}

function createAggregate(): StopAggregate {
  return {
    routeTypes: new Map(),
    directions: new Map(),
    headsigns: new Map(),
  }
}

function topHeadsigns(bucket: Map<string, number> | undefined): string[] {
  if (!bucket) return []
  return [...bucket.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h)
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(Boolean)
  const headers = splitCSVLine(lines[0]?.replace('\r', '') ?? '')
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]?.replace('\r', '') ?? '')
    const row: Record<string, string> = {}
    headers.forEach((h, ci) => { row[h] = cols[ci] ?? '' })
    rows.push(row)
  }
  return rows
}

function splitCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
      continue
    }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue }
    current += ch
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
  return value.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
