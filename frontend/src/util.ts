export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

export const fmtUptime = (sec: number | null | undefined): string => {
  if (!sec && sec !== 0) return '—'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}h ${m}m` : m ? `${m}m ${r}s` : `${r}s`
}

export const payoutClass = (p: unknown): string => {
  const v = num(p)
  if (v >= 85) return 'payout-high'
  if (v >= 70) return 'payout-mid'
  return 'payout-low'
}

export const CATEGORY_LABEL: Record<string, string> = {
  currency: 'Currencies',
  crypto: 'Crypto',
  commodity: 'Commodities',
  other: 'Indices',
}

/** Quotex's four markets, in the order the assets filter should show them. */
export const MARKETS = ['currency', 'crypto', 'commodity', 'other'] as const
export type Market = (typeof MARKETS)[number] | ''

export function isMarket(v: string): v is Exclude<Market, ''> {
  return (MARKETS as readonly string[]).includes(v)
}

export function assetInMarket(
  symbol: string,
  market: string,
  categoryBySymbol?: Record<string, string> | null,
): boolean {
  if (!market) return true
  const cat = categoryBySymbol?.[symbol]
  return cat === market
}

/** True while the signal's trade candle has not closed yet. */
export function isLiveSignal(signal: { entry_start?: number; timeframe?: number } | null | undefined, now = Date.now() / 1000): boolean {
  if (!signal) return false
  const entry = Number(signal.entry_start)
  const tf = Number(signal.timeframe)
  if (!Number.isFinite(entry) || !Number.isFinite(tf) || tf <= 0) return false
  return now < entry + tf
}

export function signalFocusKey(signal: {
  asset: string
  timeframe: number
  entry_start: number
}): string {
  return `${signal.asset}:${signal.timeframe}:${signal.entry_start}`
}

/** Soonest-closing live signal — used as the default focused card. */
export function pickSoonestActive<T extends { entry_start: number; timeframe: number }>(
  signals: T[],
  now = Date.now() / 1000,
): T | null {
  const live = signals.filter((s) => isLiveSignal(s, now))
  if (!live.length) return null
  return live.reduce((best, s) => {
    const a = Number(best.entry_start) + Number(best.timeframe)
    const b = Number(s.entry_start) + Number(s.timeframe)
    return b < a ? s : best
  })
}

export function tfShort(tf: number): string {
  if (tf === 60) return 'M1'
  if (tf === 300) return 'M5'
  if (tf === 900) return 'M15'
  return `${tf}s`
}

export const TIMEFRAMES = [
  { tf: 60, label: 'M1', minutesKey: 'tf_min_1' },
  { tf: 300, label: 'M5', minutesKey: 'tf_min_5' },
  { tf: 900, label: 'M15', minutesKey: 'tf_min_15' },
] as const

export const tfLabel = (tf: number) => TIMEFRAMES.find((t) => t.tf === tf)?.label ?? `${tf}s`

/** Prefer catalog name (e.g. "EUR/NZD (OTC)"); otherwise pretty-print the symbol. */
export function formatAssetLabel(
  symbol: string,
  nameBySymbol?: Record<string, string> | Map<string, string> | null,
): string {
  if (!symbol) return '—'
  if (nameBySymbol) {
    const named =
      nameBySymbol instanceof Map ? nameBySymbol.get(symbol) : nameBySymbol[symbol]
    if (named) return named
  }
  const otc = /_otc$/i.test(symbol)
  const base = symbol.replace(/_otc$/i, '').toUpperCase()
  let pretty = base
  if (base.length === 6 && /^[A-Z]+$/.test(base)) {
    pretty = `${base.slice(0, 3)}/${base.slice(3)}`
  }
  return otc ? `${pretty} (OTC)` : pretty
}
