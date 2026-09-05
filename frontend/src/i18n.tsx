import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'pt'

type Dict = Record<string, string>

const en: Dict = {
  brand_sub: '',
  account: 'Account',
  assets_open: 'Assets · open',
  uptime: 'Uptime',
  catalog_age: 'Catalog age',

  active: 'ACTIVE',
  current_price: 'CURRENT PRICE',
  live_quotex: 'Live Quotex data',
  next_signal: 'Next signal at the start of the candle',
  expires_in: 'expires in',
  confidence: 'Confidence',
  payout: 'payout',
  waiting_signal: 'Waiting for the first signal…',
  waiting_desc: 'Signals are computed on each closed candle. Once enough candles have streamed for this asset, the next call appears here.',

  indicators: 'Indicators',
  momentum: 'Momentum',
  candles: 'Candles',

  assets: 'Assets',
  live_payouts: 'live payouts',
  search_asset: 'Search asset…',
  all_types: 'All types',
  open_only: 'Open only',
  payout_ge: 'Payout ≥',
  col_asset: 'Asset',
  col_type: 'Type',
  col_price: 'Price',
  col_payout: 'Payout',
  col_status: 'Status',
  open: 'Open',
  closed: 'Closed',
  no_match: 'No assets match the filters.',

  signal: 'Signal',
  history: 'history',
  col_time: 'Time',
  col_signal: 'Signal',
  col_conf: 'Conf.',
  col_entry: 'Entry',
  col_closure: 'Closure',
  col_result: 'Result',
  no_scored: 'No scored signals yet.',
  last: 'last',
  win: 'win',

  cat_currency: 'Currencies',
  cat_crypto: 'Crypto',
  cat_commodity: 'Commodities',
  cat_other: 'Stocks / Indices',

  footer: '',
  chart_catalog_only_1: 'is shown from the live catalog (payout above), but its candles aren’t being streamed.',
  chart_catalog_only_2: 'Pick a live asset to see its chart.',

  banner_throttled: 'Quotex is temporarily throttling the account (anti-abuse) — the feed is waiting it out and will resume automatically.',
  banner_stalled: 'Connected, but Quotex is not sending live data (usually a partial account throttle). No prices/signals until it streams.',
  banner_expired: 'Market feed session expired — the feed reconnects automatically once the session is refreshed.',
  banner_reconnect: 'Market feed reconnecting…',

  // signal reasons (must match the backend English phrases)
  'r_EMA 9 above EMA 21': 'EMA 9 above EMA 21',
  'r_EMA 9 below EMA 21': 'EMA 9 below EMA 21',
  'r_MACD bullish': 'MACD bullish',
  'r_MACD bearish': 'MACD bearish',
  'r_RSI favors up': 'RSI favors up',
  'r_RSI favors down': 'RSI favors down',
  'r_Momentum up': 'Momentum up',
  'r_Momentum down': 'Momentum down',
  'r_Mixed indicators': 'Mixed indicators',
}

const pt: Dict = {
  brand_sub: 'Feed de mercado ao vivo · payouts em tempo real',
  account: 'Conta',
  assets_open: 'Ativos · abertos',
  uptime: 'Tempo ativo',
  catalog_age: 'Catálogo há',

  active: 'ATIVO',
  current_price: 'PREÇO ATUAL',
  live_quotex: 'Dados Quotex ao vivo',
  next_signal: 'Próximo sinal no início da vela',
  expires_in: 'expira em',
  confidence: 'Confiança',
  payout: 'payout',
  waiting_signal: 'Aguardando o primeiro sinal…',
  waiting_desc: 'Os sinais são calculados a cada vela fechada. Quando houver velas suficientes para este ativo, a próxima entrada aparece aqui.',

  indicators: 'Indicadores',
  momentum: 'Momentum',
  candles: 'Velas',

  assets: 'Ativos',
  live_payouts: 'payouts ao vivo',
  search_asset: 'Buscar ativo…',
  all_types: 'Todos os tipos',
  open_only: 'Somente abertos',
  payout_ge: 'Payout ≥',
  col_asset: 'Ativo',
  col_type: 'Tipo',
  col_price: 'Preço',
  col_payout: 'Payout',
  col_status: 'Status',
  open: 'Aberto',
  closed: 'Fechado',
  no_match: 'Nenhum ativo corresponde aos filtros.',

  signal: 'Sinal',
  history: 'histórico',
  col_time: 'Hora',
  col_signal: 'Sinal',
  col_conf: 'Conf.',
  col_entry: 'Entrada',
  col_closure: 'Fechamento',
  col_result: 'Resultado',
  no_scored: 'Nenhum sinal avaliado ainda.',
  last: 'últimos',
  win: 'acerto',

  cat_currency: 'Moedas',
  cat_crypto: 'Cripto',
  cat_commodity: 'Commodities',
  cat_other: 'Ações / Índices',

  footer: 'Feed Quotex ao vivo (somente leitura) · motor de sinais · apenas verificação — não é recomendação financeira',
  chart_catalog_only_1: 'é exibido a partir do catálogo ao vivo (payout acima), mas suas velas não estão sendo transmitidas.',
  chart_catalog_only_2: 'Escolha um ativo ao vivo para ver o gráfico.',

  banner_throttled: 'A Quotex está limitando a conta temporariamente (anti-abuso) — o feed está aguardando e retomará automaticamente.',
  banner_stalled: 'Conectado, mas a Quotex não está enviando dados ao vivo (geralmente uma limitação parcial da conta). Sem preços/sinais até transmitir.',
  banner_expired: 'A sessão do feed expirou — o feed reconecta automaticamente quando a sessão for renovada.',
  banner_reconnect: 'Reconectando o feed de mercado…',

  'r_EMA 9 above EMA 21': 'EMA 9 acima da EMA 21',
  'r_EMA 9 below EMA 21': 'EMA 9 abaixo da EMA 21',
  'r_MACD bullish': 'MACD comprador',
  'r_MACD bearish': 'MACD vendedor',
  'r_RSI favors up': 'RSI favorece alta',
  'r_RSI favors down': 'RSI favorece baixa',
  'r_Momentum up': 'Momentum de alta',
  'r_Momentum down': 'Momentum de baixa',
  'r_Mixed indicators': 'Indicadores mistos',
}

const dicts: Record<Lang, Dict> = { en, pt }

interface Ctx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string) => string
}

const I18nContext = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (k) => k })

function readLang(): Lang {
  try {
    const v = localStorage.getItem('qx_lang')
    if (v === 'pt' || v === 'en') return v
  } catch {
    /* ignore */
  }
  return 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang)
  useEffect(() => {
    try {
      localStorage.setItem('qx_lang', lang)
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang
  }, [lang])
  const t = (key: string) => dicts[lang][key] ?? dicts.en[key] ?? key
  return (
    <I18nContext.Provider value={{ lang, setLang: setLangState, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export const useI18n = () => useContext(I18nContext)
/** Translate a backend signal reason phrase. */
export const useReason = () => {
  const { t } = useI18n()
  return (phrase: string) => t(`r_${phrase}`)
}
