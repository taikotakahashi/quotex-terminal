import type { SignalResult } from '../types'
import { useI18n } from '../i18n'
import { formatAssetLabel, tfShort } from '../util'

interface Props {
  history: SignalResult[]
  timeframeLabel?: string
  nameBySymbol?: Record<string, string>
}

function clock(unix: number): string {
  if (!Number.isFinite(unix) || unix <= 0) return '--:--'
  return new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function SignalHistory({ history, timeframeLabel, nameBySymbol }: Props) {
  const { t } = useI18n()
  const wins = history.filter((h) => h.result === 'WIN').length
  const losses = history.filter((h) => h.result === 'LOSS').length
  const decided = wins + losses
  const rate = decided ? Math.round((wins / decided) * 100) : null

  return (
    <section className="panel history-panel dash-card" id="history">
      <div className="panel-head">
        <h2>
          {t('history_signals')}
        </h2>
        <div className="history-meta">
          {timeframeLabel && <span className="tf-chip">{timeframeLabel}</span>}
          <span className="count">
            {rate != null
              ? `${wins}W · ${losses}L · ${rate}% ${t('win')}`
              : t('history_signals_sub')}
          </span>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('entry_short')}</th>
              <th>{t('col_asset')}</th>
              <th>{t('col_direction')}</th>
              <th>{t('col_tempo')}</th>
              <th>{t('close_short')}</th>
              <th>{t('col_result')}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, idx) => {
              const tf = Math.max(1, Number(h.timeframe) || 60)
              // Backend `time` is the trade candle open (entry), not close.
              const entryAt = Number(h.time)
              const closeAt = entryAt + tf
              const label = formatAssetLabel(h.asset, nameBySymbol)
              return (
                <tr key={`${h.asset}-${h.time}-${idx}`}>
                  <td className="mono-cell">{clock(entryAt)}</td>
                  <td title={h.asset}>{label}</td>
                  <td>
                    <span className={`sig-tag ${h.direction === 'CALL' ? 'call' : 'put'}`}>
                      {h.direction}
                    </span>
                  </td>
                  <td className="mono-cell">{tfShort(tf)}</td>
                  <td className="mono-cell">{clock(closeAt)}</td>
                  <td>
                    <span className={`result-tag ${h.result.toLowerCase()}`}>{h.result}</span>
                  </td>
                </tr>
              )
            })}
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  {t('no_scored')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
