import type { SignalResult } from '../types'
import { useI18n } from '../i18n'

interface Props {
  history: SignalResult[]
}

function clock(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function SignalHistory({ history }: Props) {
  const { t } = useI18n()
  const wins = history.filter((h) => h.result === 'WIN').length
  const losses = history.filter((h) => h.result === 'LOSS').length
  const decided = wins + losses
  const rate = decided ? Math.round((wins / decided) * 100) : null

  return (
    <section className="panel history-panel">
      <div className="panel-head">
        <h2>{t('signal')} <span className="hl">{t('history')}</span></h2>
        <span className="count">
          {rate != null ? `${wins}W · ${losses}L · ${rate}% ${t('win')}` : `${t('last')} ${history.length}`}
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('col_time')}</th>
              <th>{t('col_signal')}</th>
              <th className="num">{t('col_conf')}</th>
              <th className="num">{t('col_entry')}</th>
              <th className="num">{t('col_closure')}</th>
              <th>{t('col_result')}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, idx) => (
              <tr key={`${h.time}-${idx}`}>
                <td className="mono-cell">{clock(h.time)}</td>
                <td>
                  <span className={`sig-tag ${h.direction === 'CALL' ? 'call' : 'put'}`}>
                    {h.direction}
                  </span>
                </td>
                <td className="num mono-cell">{h.confidence}%</td>
                <td className="num mono-cell">{h.entry_price}</td>
                <td className="num mono-cell">{h.closure_price}</td>
                <td>
                  <span className={`result-tag ${h.result.toLowerCase()}`}>{h.result}</span>
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">{t('no_scored')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
