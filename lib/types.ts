export type SupportedMode = 'tram' | 'metro' | 'bus' | 'trolleybus'

export interface StopDirectionSummary {
  stopId: string
  directionId: '0' | '1' | 'unknown'
  platformCode: string | null
  headsignSamples: string[]
  routeTypes: number[]
}

export interface IndexedStop {
  stopId: string
  name: string
  groupId: string
  groupName: string
  parentStationId: string | null
  lat: number
  lon: number
  platformCode: string | null
  routeTypes: number[]
  dominantDirectionId: '0' | '1' | 'unknown'
  headsignsByDirection: Partial<Record<'0' | '1' | 'unknown', string[]>>
  region: 'pid' | 'jmk' | 'iredo'
}

export interface StopsIndexFile {
  generatedAt: string
  sourceUrl: string
  stops: IndexedStop[]
}

// Full departure record used internally (golemio / jmk fetchers)
export interface WatchDeparture {
  line: string
  headsign: string
  predictedAt: string
  scheduledAt: string
  delaySec: number
  minutes: number
  routeType: number | null
}

// Slimmed departure sent in the API response (only fields the watch reads)
export interface SlimDeparture {
  line: string
  headsign: string
  minutes: number
  routeType: number | null
}

// Slimmed direction result sent in the API response (only fields the watch reads)
export interface WatchDirectionResult {
  label: string
  platformCode: string | null
  distanceMeters: number
  departures: SlimDeparture[]
}
