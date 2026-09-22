import { useMemo, useState } from 'react'
import type { SignalResult } from '../types'
import { useI18n } from '../i18n'

interface Props {
  history: SignalResult[]
}

interface Bar {
  label: string
  value: number
  display: string
  tone: 'up' | 'down' | 'neutral'
}

type ChartMode = 'count' | 'pct'

function maxLossStreak(history: SignalResult[]): number {
  let best = 0
  let cur = 0
  for (const h of history) {
    if (h.result === 'LOSS') {
      cur += 1
      best = Math.max(best, cur)
    } else {
      cur = 0
    }
  }
  return best
}

function MiniSpark({ tone }: { tone: 'blue' | 'teal' | 'red' }) {
  const color = tone === 'teal' ? '#2dd4bf' : tone === 'red' ? '#fb7185' : '#60a5fa'
  return (
    <svg className="analysis-mini-spark" viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden>
      <path
        d="M0 28 C12 26 18 10 30 14 S48 30 60 18 78 6 90 12 108 28 120 16"
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="120" cy="16" r="3.2" fill={color} />
    </svg>
  )
}

function MiniBars({ tone }: { tone: 'blue' | 'red' }) {
  const color = tone === 'red' ? '#fb7185' : '#60a5fa'
  const heights = tone === 'red' ? [35, 55, 28, 70, 42, 58, 32] : [40, 62, 48, 78, 55, 70, 45]
  return (
    <div className="analysis-mini-bars" aria-hidden>
      {heights.map((h, i) => (
        <i key={i} style={{ height: `${h}%`, background: color }} />
      ))}
    </div>
  )
}

export function SignalHistoryAnalysis({ history }: Props) {
  const { t } = useI18n()
  const [mode, setMode] = useState<ChartMode>('count')

  const stats = useMemo(() => {
    const wins = history.filter((h) => h.result === 'WIN').length
    const losses = history.filter((h) => h.result === 'LOSS').length
    const decided = wins + losses
    const winRate = decided ? Math.round((wins / decided) * 100) : 0
    const lossRate = decided ? Math.round((losses / decided) * 100) : 0
    const calls = history.filter((h) => h.direction === 'CALL').length
    const puts = history.filter((h) => h.direction === 'PUT').length
    const total = history.length
    const avgConf = total
      ? Math.round(history.reduce((s, h) => s + Number(h.confidence || 0), 0) / total)
      : 0
    const avgConfRatio = total
      ? history.reduce((s, h) => s + Number(h.confidence || 0), 0) / total / 100
      : 0
    const streak = maxLossStreak(history)
    const callPct = total ? Math.round((calls / total) * 100) : 0
    const putPct = total ? Math.round((puts / total) * 100) : 0

    const bars: Bar[] =
      mode === 'pct'
        ? [
            { label: t('analysis_bar_win'), value: winRate, display: `${winRate}%`, tone: 'up' },
            { label: t('analysis_bar_loss'), value: lossRate, display: `${lossRate}%`, tone: 'down' },
            {
              label: t('analysis_bar_ratio'),
              value: winRate,
              display: `${winRate}%`,
              tone: winRate >= 50 ? 'up' : 'down',
            },
            { label: t('analysis_bar_conf'), value: avgConf, display: `${avgConf}%`, tone: 'up' },
            { label: 'CALL', value: callPct, display: `${callPct}%`, tone: 'up' },
            { label: 'PUT', value: putPct, display: `${putPct}%`, tone: 'down' },
          ]
        : [
            { label: t('analysis_bar_win'), value: wins, display: String(wins), tone: 'up' },
            { label: t('analysis_bar_loss'), value: losses, display: String(losses), tone: 'down' },
            {
              label: t('analysis_bar_ratio'),
              value: winRate,
              display: `${winRate}%`,
              tone: winRate >= 50 ? 'up' : 'down',
            },
            { label: t('analysis_bar_conf'), value: avgConf, display: `${avgConf}%`, tone: 'up' },
            { label: 'CALL', value: calls, display: String(calls), tone: 'up' },
            { label: 'PUT', value: puts, display: String(puts), tone: 'down' },
          ]

    const peak = Math.max(mode === 'pct' ? 100 : 10, ...bars.map((b) => b.value), 1)
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => Math.round(peak * p))

    return {
      total,
      wins,
      losses,
      winRate,
      lossRate,
      calls,
      puts,
      avgConf,
      avgConfRatio,
      streak,
      bars,
      peak,
      ticks: ticks.reverse(),
    }
  }, [history, t, mode])

  return (
    <section className="panel analysis-panel dash-card">
      <div className="analysis-head">
        <div className="analysis-head-main">
          <div>
            <h2>{t('analysis_title')}</h2>
            <p>{t('analysis_subtitle')}</p>
          </div>
        </div>
        <span className="analysis-trades-pill">
          <i aria-hidden />
          {stats.total} {t('analysis_trades_suffix')}
        </span>
      </div>

      <div className="analysis-body">
        <div className="analysis-chart-shell">
          <div className="analysis-chart-tools">
            <span className="analysis-axis-label">{t('analysis_value')}</span>
            <div className="analysis-mode" role="group" aria-label={t('analysis_value')}>
              <button
                type="button"
                className={mode === 'count' ? 'on' : ''}
                onClick={() => setMode('count')}
              >
                {t('analysis_mode_count')}
              </button>
              <button
                type="button"
                className={mode === 'pct' ? 'on' : ''}
                onClick={() => setMode('pct')}
              >
                {t('analysis_mode_pct')}
              </button>
            </div>
          </div>

          <div className="analysis-chart" aria-hidden={stats.total === 0}>
            <div className="analysis-y">
              {stats.ticks.map((tick) => (
                <span key={tick}>{tick}</span>
              ))}
            </div>
            <div className="analysis-plot">
              <div className="analysis-grid">
                {stats.ticks.map((tick) => (
                  <i key={tick} />
                ))}
              </div>
              <div className="analysis-bars">
                {stats.bars.map((bar) => (
                  <div key={bar.label} className="analysis-col">
                    <div className="analysis-col-track">
                      <div
                        className="analysis-bar-wrap"
                        style={{ height: `${Math.max(8, (bar.value / stats.peak) * 100)}%` }}
                      >
                        <span className="analysis-bar-n">{bar.display}</span>
                        <div
                          className={`analysis-bar ${bar.tone}`}
                          title={`${bar.label}: ${bar.display}`}
                        />
                      </div>
                    </div>
                    <span className="analysis-x">{bar.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="analysis-cards">
          <div className="analysis-stat hero tone-blue">
            <div className="analysis-stat-top">
              <span className="analysis-stat-ico" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M5 18V11M10 18V7M15 18v-5M20 18V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <span className="analysis-live-pill">
                <i aria-hidden />
                {t('analysis_live')}
              </span>
            </div>
            <div className="analysis-stat-mid">
              <div className="analysis-stat-copy">
                <span className="analysis-label">{t('analysis_total_trades')}</span>
                <strong>{stats.total}</strong>
                <span className="analysis-sub">{t('analysis_all_signals')}</span>
              </div>
              <MiniSpark tone="blue" />
              <span className="analysis-motto">{t('analysis_motto')}</span>
            </div>
          </div>

          <div className="analysis-stat tone-teal">
            <div className="analysis-stat-top">
              <span className="analysis-stat-ico" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M8 17l2.2-6.2L13 14l3-7"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M7 19h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              <span className="analysis-chip">{t('analysis_win_rate_badge')}</span>
            </div>
            <div className="analysis-stat-copy">
              <span className="analysis-label">{t('analysis_win_rate')}</span>
              <strong className="up">{stats.winRate}%</strong>
              <span className="analysis-sub">
                {t('analysis_wins_losses')
                  .replace('{wins}', String(stats.wins))
                  .replace('{losses}', String(stats.losses))}
              </span>
            </div>
            <div className="analysis-progress" aria-hidden>
              <div className="analysis-progress-track">
                <div className="analysis-progress-fill" style={{ width: `${stats.winRate}%` }} />
              </div>
              <span>{stats.winRate}%</span>
            </div>
          </div>

          <div className="analysis-stat tone-blue">
            <div className="analysis-stat-top">
              <span className="analysis-stat-ico" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M5 16l5-5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="analysis-chip">{t('analysis_calls_badge')}</span>
            </div>
            <div className="analysis-stat-copy">
              <span className="analysis-label">{t('analysis_call_trades')}</span>
              <strong>{stats.calls}</strong>
              <span className="analysis-sub">
                {t('analysis_avg_conf')} {stats.avgConfRatio.toFixed(2)}
              </span>
            </div>
            <MiniBars tone="blue" />
          </div>

          <div className="analysis-stat tone-red">
            <div className="analysis-stat-top">
              <span className="analysis-stat-ico" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M5 8l5 5 3-3 6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="analysis-chip">{t('analysis_puts_badge')}</span>
            </div>
            <div className="analysis-stat-copy">
              <span className="analysis-label">{t('analysis_put_trades')}</span>
              <strong>{stats.puts}</strong>
              <span className="analysis-sub">
                {t('analysis_loss_streak')} {stats.streak}
              </span>
            </div>
            <MiniBars tone="red" />
          </div>
        </div>
      </div>
    </section>
  )
}
