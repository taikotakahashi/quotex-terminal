export interface Status {
  feed_status: string
  connected: boolean
  account_mode: string | null
  uptime_sec: number | null
  asset_count: number
  open_count: number
  instruments_age_sec: number | null
}

export interface Asset {
  code: string
  symbol: string
  name: string
  category: string
  is_otc: boolean
  open: boolean
  payout: number | string
  turbo_payout: number | string
  profit: Record<string, unknown>
  streamed?: boolean
}

export interface AssetsResponse {
  ts: number | null
  count: number
  total?: number
  streamed?: string[]
  assets: Asset[]
}

export interface Candle {
  asset: string
  timeframe: number
  start: number
  end: number
  open: number
  high: number
  low: number
  close: number
  ticks: number
}

export interface Tick {
  asset: string
  ts: number
  price: number
}

export interface Indicators {
  ema9: number | null
  ema21: number | null
  rsi14: number | null
  macd_line: number | null
  macd_signal: number | null
  macd_hist: number | null
  momentum: number | null
  candles: number
}

export interface Signal {
  asset: string
  timeframe: number
  direction: 'CALL' | 'PUT'
  confidence: number
  reasons: string[]
  schedule_start: number
  entry_start: number
  current_price: number
  indicators: Indicators
  generated_at: number
}

export interface SignalResult {
  asset: string
  timeframe: number
  time: number
  direction: 'CALL' | 'PUT'
  confidence: number
  entry_price: number
  closure_price: number
  result: 'WIN' | 'LOSS' | 'DRAW'
}

export type WsEvent =
  | { type: 'health'; data: Status & Record<string, unknown> }
  | { type: 'assets_update'; data: Record<string, unknown> }
  | { type: 'tick'; asset: string; data: Tick }
  | { type: 'candle'; asset: string; timeframe: number; data: Candle }
  | { type: 'signal'; asset: string; timeframe: number; data: Signal }
  | { type: 'signal_result'; asset: string; timeframe: number; data: SignalResult }
