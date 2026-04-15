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
  region: 'pid' | 'jmk'
}

export interface StopsIndexFile {
  generatedAt: string
  sourceUrl: string
  stops: IndexedStop[]
}

export interface WatchDeparture {
  line: string
  headsign: string
  predictedAt: string
  scheduledAt: string
  delaySec: number
  minutes: number
  routeType: number | null
}

export interface WatchDirectionResult {
  directionId: '0' | '1' | 'unknown'
  label: string
  stopId: string
  stopName: string
  groupName: string
  platformCode: string | null
  lat: number
  lon: number
  distanceMeters: number
  departures: WatchDeparture[]
}
