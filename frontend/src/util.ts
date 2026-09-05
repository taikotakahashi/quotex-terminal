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
  other: 'Stocks / Indices',
}
