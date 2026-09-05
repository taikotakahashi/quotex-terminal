import type { Indicators } from '../types'
import { useI18n } from '../i18n'

interface Props {
  indicators: Indicators | null
  timeframeLabel: string
}

function fmt(v: number | null, digits = 5): string {
  if (v === null || v === undefined) return '—'
  return v.toFixed(digits)
}

export function IndicatorsPanel({ indicators, timeframeLabel }: Props) {
  const { t } = useI18n()
  const i = indicators
  const rsi = i?.rsi14 ?? null
  const rsiClass = rsi == null ? '' : rsi >= 55 ? 'up' : rsi <= 45 ? 'down' : ''
  const macd = i?.macd_hist ?? null
  const macdClass = macd == null ? '' : macd > 0 ? 'up' : 'down'
  const mom = i?.momentum ?? null
  const momClass = mom == null ? '' : mom > 0 ? 'up' : 'down'

  return (
    <section className="panel indicators-panel">
      <div className="panel-head">
        <h2>{t('indicators')}</h2>
        <span className="count">{timeframeLabel}</span>
      </div>
      <div className="ind-grid">
        <Ind label="EMA 9" value={fmt(i?.ema9 ?? null)} />
        <Ind label="EMA 21" value={fmt(i?.ema21 ?? null)} />
        <Ind label="RSI 14" value={rsi == null ? '—' : rsi.toFixed(1)} cls={rsiClass} />
        <Ind label="MACD" value={macd == null ? '—' : (macd > 0 ? '+' : '') + macd.toFixed(5)} cls={macdClass} />
        <Ind label={t('momentum')} value={mom == null ? '—' : `${mom > 0 ? '+' : ''}${mom.toFixed(3)}%`} cls={momClass} />
        <Ind label={t('candles')} value={i ? String(i.candles) : '—'} />
      </div>
    </section>
  )
}

function Ind({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="ind-cell">
      <span className="ind-label">{label}</span>
      <span className={`ind-value ${cls}`}>{value}</span>
    </div>
  )
}
