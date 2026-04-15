import { readFileSync } from 'node:fs'
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

let _schedule: JmkSchedule | null = null

function loadSchedule(): JmkSchedule {
  if (_schedule) return _schedule
  const filePath = join(process.cwd(), 'data', 'jmk-schedule.json')
  _schedule = JSON.parse(readFileSync(filePath, 'utf8')) as JmkSchedule
  return _schedule
}

/**
 * Returns the set of service IDs active on the given date (in Prague local time).
 * Date string format: YYYYMMDD
 */
function getActiveServiceIds(schedule: JmkSchedule, dateStr: string): Set<number> {
  // Weekday index 0=Monday … 6=Sunday
  const year = Number(dateStr.slice(0, 4))
  const month = Number(dateStr.slice(4, 6)) - 1
  const day = Number(dateStr.slice(6, 8))
  const jsWeekday = new Date(year, month, day).getDay() // 0=Sun, 1=Mon…
  const weekdayIndex = jsWeekday === 0 ? 6 : jsWeekday - 1 // convert to Mon=0

  const active = new Set<number>()

  for (const [sidStr, cal] of Object.entries(schedule.calendar)) {
    const sid = Number(sidStr)
    const [mon, tue, wed, thu, fri, sat, sun, startDate, endDate] = cal
    const days = [mon, tue, wed, thu, fri, sat, sun]

    if (dateStr < startDate || dateStr > endDate) continue
    if (!days[weekdayIndex]) continue

    // Check for removal exception on this date
    const exceptions = schedule.calendarDates[sidStr]
    if (exceptions?.[dateStr] === 2) continue // removed

    active.add(sid)
  }

  // Apply addition exceptions (exception_type=1)
  for (const [sidStr, exceptions] of Object.entries(schedule.calendarDates)) {
    if (exceptions[dateStr] === 1) active.add(Number(sidStr))
  }

  return active
}

/**
 * Returns scheduled departures from a JMK stop within the next 60 minutes.
 * No real-time delay data is available (GTFS-RT has no trip updates).
 */
export function fetchJmkDepartures(stopId: string, limit: number): WatchDeparture[] {
  const schedule = loadSchedule()

  // Current Prague time
  const now = new Date()
  const pragueStr = now.toLocaleString('sv-SE', { timeZone: 'Europe/Prague' })
  // sv-SE locale gives ISO-like "YYYY-MM-DD HH:MM:SS"
  const dateStr = pragueStr.slice(0, 10).replace(/-/g, '')
  const [hStr, mStr, sStr] = pragueStr.slice(11).split(':')
  const nowSecs = Number(hStr) * 3600 + Number(mStr) * 60 + Number(sStr)
  const windowEnd = nowSecs + 3600 // 60 minutes ahead

  const activeServices = getActiveServiceIds(schedule, dateStr)

  const entries = schedule.stops[stopId]
  if (!entries) return []

  // GTFS allows times > 86400 for after-midnight trips on the previous service day.
  // We also check the previous day's services for those cases.
  const prevDate = new Date(Number(dateStr.slice(0, 4)), Number(dateStr.slice(4, 6)) - 1, Number(dateStr.slice(6, 8)) - 1)
  const prevDateStr = prevDate.toLocaleDateString('sv-SE').replace(/-/g, '')
  const prevActiveServices = getActiveServiceIds(schedule, prevDateStr)

  const results: WatchDeparture[] = []

  for (const [serviceId, depSecs, line, headsign, routeType] of entries) {
    // Normal case: departure is today's service
    let minutes: number | null = null
    if (activeServices.has(serviceId) && depSecs >= nowSecs && depSecs <= windowEnd) {
      minutes = Math.round((depSecs - nowSecs) / 60)
    }
    // After-midnight case: departure time > 24h on yesterday's service
    else if (prevActiveServices.has(serviceId) && depSecs >= 86400) {
      const adjustedSecs = depSecs - 86400
      if (adjustedSecs >= nowSecs && adjustedSecs <= windowEnd) {
        minutes = Math.round((adjustedSecs - nowSecs) / 60)
      }
    }

    if (minutes === null) continue

    // Compute ISO timestamps from the scheduled departure time
    const depDate = new Date(now)
    depDate.setSeconds(depDate.getSeconds() + minutes * 60 - (depSecs - nowSecs - minutes * 60 * 1))
    // Simpler: build the departure ISO string directly from schedule
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
