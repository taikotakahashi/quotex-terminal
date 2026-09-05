import type { AssetsResponse, Candle, Signal, SignalResult, Status, WsEvent } from './types'

// Backend base URL. Override at build/run time with VITE_API_BASE; otherwise
// derive from the host serving this page (so opening the dashboard via the
// machine's LAN IP still reaches the API on the same host, port 8000).
const API_BASE =
  (import.meta.env.VITE_API_BASE as string) ||
  `${window.location.protocol}//${window.location.hostname}:8000`

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

export const api = {
  status: () => getJson<Status>('/api/status'),
  assets: () => getJson<AssetsResponse>('/api/assets'),
  candles: (asset: string, tf: number, limit = 120) =>
    getJson<{ asset: string; timeframe: number; candles: Candle[] }>(
      `/api/candles/${encodeURIComponent(asset)}/${tf}?limit=${limit}`,
    ),
  signal: (asset: string, tf: number) =>
    getJson<{ asset: string; timeframe: number; signal: Signal | null; history: SignalResult[] }>(
      `/api/signal/${encodeURIComponent(asset)}/${tf}?history=12`,
    ),
}

/** Open a resilient WebSocket to the live feed. Auto-reconnects with backoff. */
export function connectFeed(
  onEvent: (e: WsEvent) => void,
  onState: (connected: boolean) => void,
): () => void {
  const wsBase = API_BASE.replace(/^http/, 'ws')
  let ws: WebSocket | null = null
  let closed = false
  let retry = 0
  let timer: number | undefined

  const open = () => {
    ws = new WebSocket(`${wsBase}/ws`)
    ws.onopen = () => {
      retry = 0
      onState(true)
    }
    ws.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data) as WsEvent)
      } catch {
        /* ignore malformed frame */
      }
    }
    ws.onclose = () => {
      onState(false)
      if (closed) return
      retry += 1
      const delay = Math.min(1000 * 2 ** retry, 15000)
      timer = window.setTimeout(open, delay)
    }
    ws.onerror = () => ws?.close()
  }

  open()
  return () => {
    closed = true
    if (timer) window.clearTimeout(timer)
    ws?.close()
  }
}
