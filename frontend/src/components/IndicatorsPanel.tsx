import { useMemo } from 'react'
import type { Candle, Indicators } from '../types'
import { useI18n } from '../i18n'
import { AssetIcon } from './AssetIcon'

interface Props {
  indicators: Indicators | null
  timeframeLabel: string
  assetName?: string
  assetSymbol?: string
  /** Recent candles for sparklines (same asset when available). */
  candles?: Candle[]
}

function fmt(v: number | null, digits = 5): string {
  if (v === null || v === undefined) return '—'
  return v.toFixed(digits)
}

function trendClass(v: number | null, upWhenPositive = true): string {
  if (v == null) return ''
  const up = upWhenPositive ? v > 0 : v >= 55
  const down = upWhenPositive ? v < 0 : v <= 45
  return up ? 'up' : down ? 'down' : 'flat'
}

function emaSeries(closes: number[], period: number): number[] {
  if (!closes.length) return []
  const k = 2 / (period + 1)
  const out: number[] = []
  let prev = closes[0]
  for (let i = 0; i < closes.length; i++) {
    prev = i === 0 ? closes[0] : closes[i] * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

function rsiSeries(closes: number[], period = 14): number[] {
  if (closes.length < 2) return []
  const out: number[] = []
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    const gain = Math.max(0, d)
    const loss = Math.max(0, -d)
    if (i <= period) {
      avgGain += gain
      avgLoss += loss
      if (i === period) {
        avgGain /= period
        avgLoss /= period
      }
      if (i < period) {
        out.push(50)
        continue
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    out.push(100 - 100 / (1 + rs))
  }
  return out
}

function macdHistSeries(closes: number[]): number[] {
  if (closes.length < 3) return []
  const e12 = emaSeries(closes, 12)
  const e26 = emaSeries(closes, 26)
  const macd = e12.map((v, i) => v - e26[i])
  const signal = emaSeries(macd, 9)
  return macd.map((v, i) => v - signal[i])
}

function momentumSeries(closes: number[], lookback = 10): number[] {
  if (closes.length <= lookback) return []
  const out: number[] = []
  for (let i = lookback; i < closes.length; i++) {
    const base = closes[i - lookback]
    out.push(base === 0 ? 0 : ((closes[i] - base) / base) * 100)
  }
  return out
}

function pctChange(series: number[]): number | null {
  if (series.length < 2) return null
  const a = series[series.length - 2]
  const b = series[series.length - 1]
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null
  return ((b - a) / Math.abs(a)) * 100
}

function Sparkline({
  values,
  color,
  fill = true,
}: {
  values: number[]
  color: string
  fill?: boolean
}) {
  if (values.length < 2) return <div className="ind-spark empty" aria-hidden />
  const w = 120
  const h = 36
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / span) * (h - 4) - 2
    return [x, y] as const
  })
  const line = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `0,${h} ${line} ${w},${h}`
  return (
    <svg className="ind-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      {fill && <polygon points={area} fill={color} opacity="0.16" />}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="nonScalingStroke"
      />
    </svg>
  )
}

function HistSpark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="ind-spark empty" aria-hidden />
  const w = 120
  const h = 36
  const peak = Math.max(...values.map((v) => Math.abs(v)), 1e-9)
  const n = values.length
  const gap = 1.2
  const barW = Math.max(1.5, w / n - gap)
  const mid = h / 2
  return (
    <svg className="ind-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <line x1="0" y1={mid} x2={w} y2={mid} stroke="rgba(148,163,184,0.25)" strokeWidth="1" />
      {values.map((v, i) => {
        const bh = (Math.abs(v) / peak) * (mid - 2)
        const x = i * (barW + gap)
        const y = v >= 0 ? mid - bh : mid
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={Math.max(1.2, bh)}
            rx="0.8"
            fill={v >= 0 ? 'var(--up)' : 'var(--down)'}
            opacity="0.9"
          />
        )
      })}
    </svg>
  )
}

function CandleSpark({ candles }: { candles: Candle[] }) {
  const bars = candles.slice(-14)
  if (bars.length < 2) return <div className="ind-spark empty" aria-hidden />
  const w = 120
  const h = 36
  let lo = Infinity
  let hi = -Infinity
  for (const b of bars) {
    lo = Math.min(lo, b.low)
    hi = Math.max(hi, b.high)
  }
  const span = hi - lo || 1
  const n = bars.length
  const gap = 1.4
  const barW = Math.max(2, w / n - gap)
  const y = (p: number) => h - ((p - lo) / span) * (h - 4) - 2
  return (
    <svg className="ind-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      {bars.map((b, i) => {
        const up = b.close >= b.open
        const x = i * (barW + gap) + barW / 2
        const top = y(Math.max(b.open, b.close))
        const bot = y(Math.min(b.open, b.close))
        const color = up ? 'var(--up)' : 'var(--down)'
        return (
          <g key={i}>
            <line
              x1={x}
              x2={x}
              y1={y(b.high)}
              y2={y(b.low)}
              stroke={color}
              strokeWidth="1"
              vectorEffect="nonScalingStroke"
            />
            <rect
              x={x - barW / 2}
              y={top}
              width={barW}
              height={Math.max(1.5, bot - top)}
              rx="0.6"
              fill={color}
            />
          </g>
        )
      })}
    </svg>
  )
}

function fmtPct(v: number | null): string | null {
  if (v == null || !Number.isFinite(v)) return null
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

export function IndicatorsPanel({
  indicators,
  timeframeLabel,
  assetName,
  assetSymbol,
  candles = [],
}: Props) {
  const { t } = useI18n()
  const i = indicators
  const rsi = i?.rsi14 ?? null
  const macd = i?.macd_hist ?? null
  const mom = i?.momentum ?? null
  const ema9 = i?.ema9 ?? null
  const ema21 = i?.ema21 ?? null
  const emaBias = ema9 != null && ema21 != null ? (ema9 >= ema21 ? 'up' : 'down') : ''

  const series = useMemo(() => {
    const closes = candles.map((c) => Number(c.close)).filter((n) => Number.isFinite(n))
    const slice = closes.slice(-48)
    const e9 = emaSeries(slice, 9)
    const e21 = emaSeries(slice, 21)
    return {
      e9: e9.slice(-24),
      e21: e21.slice(-24),
      e9pct: pctChange(e9),
      e21pct: pctChange(e21),
      rsi: rsiSeries(slice, 14).slice(-24),
      macd: macdHistSeries(slice).slice(-24),
      mom: momentumSeries(slice, 10).slice(-24),
      candles: candles.slice(-16),
    }
  }, [candles])

  return (
    <section className="panel indicators-panel dash-card">
      <div className="panel-head ind-head">
        <h2>{t('indicators')}</h2>
      </div>

      {(assetSymbol || assetName) && (
        <div className="ind-asset-row">
          {assetSymbol ? (
            <AssetIcon
              symbol={assetSymbol}
              name={assetName}
              size="sm"
              className="ind-asset-icon"
            />
          ) : null}
          <span className="ind-asset-name">{assetName || assetSymbol}</span>
          <span className="tf-chip">{timeframeLabel}</span>
        </div>
      )}

      <div className="ind-layout">
        <div className="ind-body">
          <div className="ind-cards">
            <article className={`ind-card theme-ema9 ${emaBias}`}>
              <div className="ind-card-main">
                <div className="ind-card-copy">
                  <span className="ind-label">EMA 9</span>
                  <span className={`ind-value ${emaBias || 'up'}`}>{fmt(ema9)}</span>
                  {fmtPct(series.e9pct) && (
                    <span className={`ind-delta ${series.e9pct! >= 0 ? 'up' : 'down'}`}>
                      {fmtPct(series.e9pct)}
                    </span>
                  )}
                </div>
                {emaBias === 'up' && <span className="ind-trend-pip" aria-hidden>▲</span>}
                {emaBias === 'down' && (
                  <span className="ind-trend-pip down" aria-hidden>
                    ▼
                  </span>
                )}
              </div>
              <Sparkline values={series.e9} color="var(--up)" />
            </article>

            <article className={`ind-card theme-ema21 ${emaBias}`}>
              <div className="ind-card-main">
                <div className="ind-card-copy">
                  <span className="ind-label">EMA 21</span>
                  <span className={`ind-value tone-blue`}>{fmt(ema21)}</span>
                  {fmtPct(series.e21pct) && (
                    <span className={`ind-delta ${series.e21pct! >= 0 ? 'up' : 'down'}`}>
                      {fmtPct(series.e21pct)}
                    </span>
                  )}
                </div>
              </div>
              <Sparkline values={series.e21} color="var(--blue)" />
            </article>

            <article className={`ind-card theme-rsi ${trendClass(rsi, false)}`}>
              <div className="ind-card-main">
                <div className="ind-card-copy">
                  <span className="ind-label">RSI 14</span>
                  <span className="ind-value tone-white">
                    {rsi == null ? '—' : rsi.toFixed(1)}
                  </span>
                </div>
              </div>
              <Sparkline values={series.rsi} color="var(--purple)" />
            </article>

            <article className={`ind-card theme-macd ${trendClass(macd)}`}>
              <div className="ind-card-main">
                <div className="ind-card-copy">
                  <span className="ind-label">MACD</span>
                  <span className={`ind-value ${trendClass(macd)}`}>
                    {macd == null ? '—' : `${macd > 0 ? '+' : ''}${macd.toFixed(5)}`}
                  </span>
                </div>
              </div>
              <HistSpark values={series.macd} />
            </article>

            <article className={`ind-card theme-mom ${trendClass(mom)}`}>
              <div className="ind-card-main">
                <div className="ind-card-copy">
                  <span className="ind-label">{t('momentum')}</span>
                  <span className={`ind-value ${trendClass(mom)}`}>
                    {mom == null ? '—' : `${mom > 0 ? '+' : ''}${mom.toFixed(3)}%`}
                  </span>
                </div>
              </div>
              <Sparkline values={series.mom} color="var(--up)" />
            </article>

            <article className="ind-card theme-candles">
              <div className="ind-card-main">
                <div className="ind-card-copy">
                  <span className="ind-label">{t('candles')}</span>
                  <span className="ind-value tone-white">{i ? String(i.candles) : '—'}</span>
                </div>
              </div>
              <CandleSpark candles={series.candles} />
            </article>
          </div>
        </div>
      </div>
    </section>
  )
}
