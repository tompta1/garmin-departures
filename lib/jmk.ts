import { head, list } from '@vercel/blob'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WatchDeparture } from './types.js'

// Schedule entry: [serviceId, departureSecs, line, headsign, routeType]
type ScheduleEntry = [number, number, string, string, number]

interface JmkSchedule {
  generatedAt: string
  calendar: Record<string, [number, number, number, number, number, number, number, string, string]>
  calendarDates: Record<string, Record<string, number>>
  stops: Record<string, ScheduleEntry[]>
}

// In-memory cache: holds the schedule for the lifetime of the function instance.
// Vercel Blob is the source of truth; we re-fetch when the cache is empty (cold start).
let _schedule: JmkSchedule | null = null
let _scheduleGeneratedAt: string | null = null

async function loadSchedule(): Promise<JmkSchedule> {
  if (_schedule) return _schedule

  // 1. Try Vercel Blob (production path)
  const blobToken = process.env['BLOB_READ_WRITE_TOKEN']
  if (blobToken) {
    try {
      const { blobs } = await list({ prefix: 'jmk/schedule.json', token: blobToken })
      const blob = blobs[0]
      if (blob) {
        const res = await fetch(blob.url)
        if (res.ok) {
          _schedule = await res.json() as JmkSchedule
          _scheduleGeneratedAt = _schedule.generatedAt
          console.log(`JMK schedule loaded from Blob (generated ${_scheduleGeneratedAt})`)
          return _schedule
        }
      }
    } catch (err) {
      console.warn('Failed to load JMK schedule from Blob, falling back to local file:', err)
    }
  }

  // 2. Fallback: bundled local file (local dev or first deploy before cron runs)
  const filePath = join(process.cwd(), 'data', 'jmk-schedule.json')
  if (existsSync(filePath)) {
    _schedule = JSON.parse(readFileSync(filePath, 'utf8')) as JmkSchedule
    _scheduleGeneratedAt = _schedule.generatedAt
    console.log(`JMK schedule loaded from local file (generated ${_scheduleGeneratedAt})`)
    return _schedule
  }

  throw new Error(
    'JMK schedule not available. Run `npm run build:stops:jmk` locally or trigger the /api/cron-refresh-jmk endpoint.',
  )
}

/**
 * Returns the set of service IDs active on the given date (in Prague local time).
 * Date string format: YYYYMMDD
 */
function getActiveServiceIds(schedule: JmkSchedule, dateStr: string): Set<number> {
  const year = Number(dateStr.slice(0, 4))
  const month = Number(dateStr.slice(4, 6)) - 1
  const day = Number(dateStr.slice(6, 8))
  const jsWeekday = new Date(year, month, day).getDay() // 0=Sun, 1=Mon…
  const weekdayIndex = jsWeekday === 0 ? 6 : jsWeekday - 1 // Mon=0

  const active = new Set<number>()

  for (const [sidStr, cal] of Object.entries(schedule.calendar)) {
    const sid = Number(sidStr)
    const [mon, tue, wed, thu, fri, sat, sun, startDate, endDate] = cal
    const days = [mon, tue, wed, thu, fri, sat, sun]

    if (dateStr < startDate || dateStr > endDate) continue
    if (!days[weekdayIndex]) continue

    const exceptions = schedule.calendarDates[sidStr]
    if (exceptions?.[dateStr] === 2) continue // removal exception

    active.add(sid)
  }

  // Addition exceptions
  for (const [sidStr, exceptions] of Object.entries(schedule.calendarDates)) {
    if (exceptions[dateStr] === 1) active.add(Number(sidStr))
  }

  return active
}

/**
 * Returns scheduled departures from a JMK stop within the next 60 minutes.
 */
export async function fetchJmkDepartures(stopId: string, limit: number): Promise<WatchDeparture[]> {
  const schedule = await loadSchedule()

  const now = new Date()
  const pragueStr = now.toLocaleString('sv-SE', { timeZone: 'Europe/Prague' })
  const dateStr = pragueStr.slice(0, 10).replace(/-/g, '')
  const [hStr, mStr, sStr] = pragueStr.slice(11).split(':')
  const nowSecs = Number(hStr) * 3600 + Number(mStr) * 60 + Number(sStr)
  const windowEnd = nowSecs + 3600

  const activeServices = getActiveServiceIds(schedule, dateStr)

  const entries = schedule.stops[stopId]
  if (!entries) return []

  // Previous service day for after-midnight trips (GTFS times > 86400)
  const prevDate = new Date(Number(dateStr.slice(0, 4)), Number(dateStr.slice(4, 6)) - 1, Number(dateStr.slice(6, 8)) - 1)
  const prevDateStr = prevDate.toLocaleDateString('sv-SE').replace(/-/g, '')
  const prevActiveServices = getActiveServiceIds(schedule, prevDateStr)

  const results: WatchDeparture[] = []

  for (const [serviceId, depSecs, line, headsign, routeType] of entries) {
    let minutes: number | null = null

    if (activeServices.has(serviceId) && depSecs >= nowSecs && depSecs <= windowEnd) {
      minutes = Math.round((depSecs - nowSecs) / 60)
    } else if (prevActiveServices.has(serviceId) && depSecs >= 86400) {
      const adjustedSecs = depSecs - 86400
      if (adjustedSecs >= nowSecs && adjustedSecs <= windowEnd) {
        minutes = Math.round((adjustedSecs - nowSecs) / 60)
      }
    }

    if (minutes === null) continue

    const depMs = now.getTime() + minutes * 60_000
    const depISO = new Date(depMs).toISOString()

    results.push({
      line,
      headsign,
      predictedAt: depISO,
      scheduledAt: depISO,
      delaySec: 0,
      minutes,
      routeType,
    })

    if (results.length >= limit) break
  }

  return results.sort((a, b) => a.minutes - b.minutes)
}
