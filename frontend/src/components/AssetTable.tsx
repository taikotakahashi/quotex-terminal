import { useEffect, useMemo, useRef, useState } from 'react'
import type { Asset } from '../types'
import { MARKETS, num, payoutClass } from '../util'
import { useI18n } from '../i18n'
import { AssetIcon } from './AssetIcon'

interface Props {
  assets: Asset[]
  prices: Record<string, number>
  selected: string
  onSelect: (symbol: string) => void
  activeSymbols?: string[]
  category: string
  onCategoryChange: (category: string) => void
}

/** Price cell that briefly flashes green/red when the value ticks. */
function PriceCell({ value, streamed }: { value?: number; streamed?: boolean }) {
  const prev = useRef<number | undefined>(undefined)
  const [flash, setFlash] = useState('')
  useEffect(() => {
    if (value == null) return
    if (prev.current != null && value !== prev.current) {
      setFlash(value > prev.current ? 'flash-up' : 'flash-down')
      const t = setTimeout(() => setFlash(''), 500)
      prev.current = value
      return () => clearTimeout(t)
    }
    prev.current = value
  }, [value])

  return (
    <td className="num price-cell">
      {streamed && value != null && <span className="live-pip" title="Live" aria-hidden />}
      <span className={`price ${flash}`}>{value != null ? value : '—'}</span>
    </td>
  )
}

export function AssetTable({
  assets,
  prices,
  selected,
  onSelect,
  activeSymbols = [],
  category,
  onCategoryChange,
}: Props) {
  const { t } = useI18n()
  const activeSet = useMemo(() => new Set(activeSymbols), [activeSymbols])
  const [q, setQ] = useState('')
  const [openOnly, setOpenOnly] = useState(true)
  const [minPayout, setMinPayout] = useState(0)

  const catLabel = (a: Asset) => (a.is_otc ? 'OTC' : t(`cat_${a.category}`))

  const categories = useMemo(() => {
    const present = new Set(assets.map((a) => a.category))
    const ordered: string[] = MARKETS.filter((c) => present.has(c))
    for (const c of present) {
      if (!ordered.includes(c)) ordered.push(c)
    }
    return ordered
  }, [assets])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return assets
      .filter((a) => (openOnly ? a.open : true))
      .filter((a) => (category ? a.category === category : true))
      .filter((a) => num(a.payout) >= minPayout)
      .filter(
        (a) =>
          !needle ||
          a.symbol.toLowerCase().includes(needle) ||
          a.name.toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        const sa = a.streamed && a.open ? 1 : 0
        const sb = b.streamed && b.open ? 1 : 0
        if (sa !== sb) return sb - sa
        return num(b.payout) - num(a.payout)
      })
  }, [assets, q, openOnly, minPayout, category])

  return (
    <section className="panel table-panel dash-card" id="assets">
      <div className="panel-head">
        <h2>{t('assets')} - {t('live_payouts')}</h2>
        <span className="count">{rows.length}</span>
      </div>

      <div className="filters">
        <input
          className="search"
          placeholder={t('search_asset')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          aria-label={t('all_types')}
        >
          <option value="">{t('all_types')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {t(`cat_${c}`)}
            </option>
          ))}
        </select>
        <label className="chk">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          {t('open_only')}
        </label>
        <label className="range">
          {t('payout_ge')} {minPayout}%
          <input
            type="range"
            min={0}
            max={95}
            step={5}
            value={minPayout}
            onChange={(e) => setMinPayout(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('col_asset')}</th>
              <th>{t('col_type')}</th>
              <th className="num">{t('col_price')}</th>
              <th className="num">{t('col_payout')}</th>
              <th>{t('col_status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr
                key={a.symbol}
                className={a.symbol === selected ? 'sel' : ''}
                onClick={() => onSelect(a.symbol)}
              >
                <td>
                  <div className="asset-cell">
                    <AssetIcon symbol={a.symbol} name={a.name} size="sm" />
                    <div className="asset-text">
                      <div className="asset-name">
                        {a.name}
                        {activeSet.has(a.symbol) && <span className="sig-live-pip" title={t('active_signals')} />}
                      </div>
                      <div className="asset-sym">{a.symbol}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="cat">{catLabel(a)}</span>
                </td>
                <PriceCell value={prices[a.symbol]} streamed={a.streamed} />
                <td className="num">
                  <span className={`payout ${payoutClass(a.payout)}`}>{num(a.payout)}%</span>
                </td>
                <td className="status-cell">
                  <span className={`status-dot ${a.open ? 'open' : 'closed'}`} />
                  {a.open ? t('open') : t('closed')}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  {t('no_match')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
