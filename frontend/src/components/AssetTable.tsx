import { useEffect, useMemo, useRef, useState } from 'react'
import type { Asset } from '../types'
import { num, payoutClass } from '../util'
import { useI18n } from '../i18n'

interface Props {
  assets: Asset[]
  prices: Record<string, number>
  selected: string
  onSelect: (symbol: string) => void
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
      {streamed && <span className="live-tag">●</span>}
      <span className={`price ${flash}`}>{value != null ? value : streamed ? '…' : '—'}</span>
    </td>
  )
}

export function AssetTable({ assets, prices, selected, onSelect }: Props) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [openOnly, setOpenOnly] = useState(true)
  const [minPayout, setMinPayout] = useState(0)
  const [category, setCategory] = useState('')

  const catLabel = (a: Asset) => (a.is_otc ? 'OTC' : t(`cat_${a.category}`))

  const categories = useMemo(
    () => Array.from(new Set(assets.map((a) => a.category))).sort(),
    [assets],
  )

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
    <section className="panel table-panel">
      <div className="panel-head">
        <h2>{t('assets')} · <span className="hl">{t('live_payouts')}</span></h2>
        <span className="count">{rows.length}</span>
      </div>

      <div className="filters">
        <input
          className="search"
          placeholder={t('search_asset')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
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
                  <div className="asset-name">{a.name}</div>
                  <div className="asset-sym">{a.symbol}</div>
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
