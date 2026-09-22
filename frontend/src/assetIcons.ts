/** Resolve Quotex symbols into official Quotex flag-sprite icon ids. */

import { QUOTEX_FLAG_IDS } from './quotexFlagIds'

export type IconKind = 'qx' | 'fallback'

export interface IconPart {
  kind: IconKind
  /** Quotex sprite id without the `flag-` prefix, or fallback label. */
  id: string
  label?: string
}

export interface AssetIconSpec {
  parts: IconPart[]
}

/** ISO currency → Quotex sprite token used in flags.svg */
const FIAT_TO_QX: Record<string, string> = {
  USD: 'usd',
  EUR: 'eur',
  GBP: 'gbp',
  JPY: 'jpy',
  AUD: 'aud',
  NZD: 'nzd',
  CAD: 'cad',
  CHF: 'chf',
  MXN: 'mxn',
  INR: 'inr',
  BRL: 'brl',
  ARS: 'ars',
  BDT: 'bdt',
  COP: 'cop',
  DZD: 'dzd',
  EGP: 'egp',
  IDR: 'idr',
  NGN: 'ngn',
  PHP: 'php',
  PKR: 'pkr',
  ZAR: 'zar',
  HKD: 'hk',
  CNY: 'cn',
  SGD: 'sgd',
  TRY: 'try',
  RUB: 'rub',
  KRW: 'kr',
  SEK: 'se',
  NOK: 'no',
  DKK: 'dk',
  PLN: 'pl',
  THB: 'thb',
  VND: 'vn',
}

const FIAT_CODES = Object.keys(FIAT_TO_QX).sort((a, b) => b.length - a.length)

/** Exact Quotex symbol (no _otc) → sprite token. */
const SYMBOL_TO_QX: Record<string, string> = {
  AXSUSD: 'axs',
  TONUSD: 'ton',
  TRUUSD: 'tru',
  XAUUSD: 'xau',
  XAGUSD: 'xag',
  USCRUDE: 'uscrude',
  UKBRENT: 'ukbrent',
  AXJAUD: 'axjaud',
  CHIA50: 'chia50',
  F40EUR: 'f40eur',
  FTSGBP: 'ftsgbp',
  HSIHKD: 'hsihkd',
  IBXEUR: 'ibxeur',
  JPXJPY: 'jpxjpy',
  STXEUR: 'stxeur',
  BTCUSD: 'btc',
  ETHUSD: 'eth',
  LTCUSD: 'ltc',
  XRPUSD: 'xrp',
  BNBUSD: 'bnb',
  BCHUSD: 'bch',
  DOTUSD: 'dot',
  SOLUSD: 'sol',
  AVAUSD: 'ava',
  ATOUSD: 'ato',
  DASUSD: 'das',
  ETCUSD: 'etc',
  LINUSD: 'lin',
  ZECUSD: 'zec',
}

function stripOtc(symbol: string): string {
  return symbol.replace(/_otc$/i, '')
}

function qxId(token: string): string | null {
  const t = token.toLowerCase()
  return QUOTEX_FLAG_IDS.has(t) ? t : null
}

function fiatToken(code: string): string | null {
  const mapped = FIAT_TO_QX[code.toUpperCase()]
  if (mapped) {
    const id = qxId(mapped)
    if (id) return id
  }
  return qxId(code)
}

function parseSlashName(name: string): [string, string] | null {
  const m = name.match(/([A-Z]{3})\s*\/\s*([A-Z]{3})/i)
  if (!m) return null
  return [m[1].toUpperCase(), m[2].toUpperCase()]
}

function parseForexPair(baseSym: string): [string, string] | null {
  const s = baseSym.toUpperCase()
  for (const a of FIAT_CODES) {
    if (!s.startsWith(a)) continue
    const rest = s.slice(a.length)
    if (FIAT_TO_QX[rest]) return [a, rest]
  }
  return null
}

function part(id: string, label?: string): IconPart {
  return { kind: 'qx', id, label: label || id.toUpperCase() }
}

export function resolveAssetIcons(symbol: string, name?: string): AssetIconSpec {
  const base = stripOtc(symbol)
  const upper = base.toUpperCase()

  const dedicated = SYMBOL_TO_QX[upper]
  if (dedicated && qxId(dedicated)) {
    return { parts: [part(dedicated, upper)] }
  }

  // Non-forex tickers that match a sprite id directly (e.g. future assets).
  if (!parseForexPair(upper)) {
    const direct = qxId(upper) || qxId(upper.replace(/USD$/i, ''))
    if (direct) return { parts: [part(direct, upper)] }
  }

  const fromName = name ? parseSlashName(name) : null
  // Prefer catalog name order (BRLUSD_otc is "USD/BRL").
  const pair = fromName || parseForexPair(upper)
  if (pair) {
    const a = fiatToken(pair[0])
    const b = fiatToken(pair[1])
    if (a && b) return { parts: [part(a, pair[0]), part(b, pair[1])] }
    if (a) return { parts: [part(a, pair[0])] }
    if (b) return { parts: [part(b, pair[1])] }
  }

  const initials = (name || symbol).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?'
  return { parts: [{ kind: 'fallback', id: initials, label: initials }] }
}

export function quotexFlagHref(id: string): string {
  return `/asset-icons/flags.svg#flag-${id.toLowerCase()}`
}
