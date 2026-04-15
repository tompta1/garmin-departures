import type { VercelRequest, VercelResponse } from '@vercel/node'

const ALLOWED_ORIGIN = process.env['ALLOWED_ORIGIN'] ?? ''

export function setCors(req: VercelRequest, res: VercelResponse): void {
  const origin = req.headers['origin']
  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export function isAllowedOrigin(req: VercelRequest): boolean {
  if (!ALLOWED_ORIGIN) return true
  const origin = req.headers['origin']
  if (!origin) return true
  return origin === ALLOWED_ORIGIN
}

export function handlePreflight(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method !== 'OPTIONS') return false
  setCors(req, res)
  res.status(204).end()
  return true
}
