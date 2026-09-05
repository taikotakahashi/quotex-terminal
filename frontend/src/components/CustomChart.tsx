import { useEffect, useRef } from 'react'
import type { Candle } from '../types'
import { useTheme } from '../theme'

interface Props {
  candles: Candle[]
  liveCandle?: Candle | null
  /** Changing this (asset + timeframe) resets the zoom/pan view. */
  viewKey?: string
}

const THEME = {
  dark: {
    grid: 'rgba(255,255,255,0.05)', text: '#8890a3',
    up: '#0fca7f', down: '#f14d5b', tagText: '#06231a', cross: 'rgba(255,255,255,0.25)',
  },
  light: {
    grid: 'rgba(16,24,40,0.07)', text: '#5a6a79',
    up: '#0bb673', down: '#e23f4d', tagText: '#ffffff', cross: 'rgba(16,24,40,0.3)',
  },
}

const MONO = '11px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
const MIN_BARS = 8 // most zoomed-in

/** A dependency-free candlestick chart drawn on canvas, styled like Quotex.
 *  Supports scroll-wheel zoom (anchored at the cursor) and click/touch drag
 *  to pan back through history, like the old TradingView chart. */
export function CustomChart({ candles, liveCandle, viewKey }: Props) {
  const { theme } = useTheme()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dataRef = useRef<{ candles: Candle[]; live: Candle | null }>({ candles: [], live: null })
  const themeRef = useRef(theme)
  const drawRef = useRef<() => void>(() => {})
  // View state: `count` = visible bars (zoom), `offset` = bars scrolled back from the live edge.
  const viewRef = useRef({ count: 0, offset: 0, ready: false })
  // Last computed layout, so the wheel/drag handlers can map pixels ↔ bars.
  const layoutRef = useRef({ padL: 6, plotW: 0, count: 0, N: 0 })
  // Cursor position for the crosshair (null when the pointer is off the chart).
  const hoverRef = useRef<{ x: number; y: number } | null>(null)

  dataRef.current = { candles, live: liveCandle ?? null }
  themeRef.current = theme

  // Set up the canvas + resize observer + interaction handlers once.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const requestDraw = () => requestAnimationFrame(() => drawRef.current())

    const draw = () => {
      const th = THEME[themeRef.current]
      const { candles, live } = dataRef.current
      const W = canvas.clientWidth
      const H = canvas.clientHeight
      if (W <= 0 || H <= 0) return

      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // Merge the forming/live candle onto the history.
      let bars = candles
      if (live) {
        const last = candles[candles.length - 1]
        if (!last || live.start > last.start) bars = [...candles, live]
        else if (live.start === last.start) bars = [...candles.slice(0, -1), live]
      }
      const N = bars.length
      if (N === 0) return

      // Layout: right axis width sized to the price label. Compute precision first.
      let prec = 2
      for (const b of bars.slice(-25)) {
        for (const v of [b.open, b.close, b.high, b.low]) {
          const s = String(v)
          const d = s.indexOf('.')
          if (d >= 0) prec = Math.max(prec, Math.min(6, s.length - d - 1))
        }
      }
      const fmt = (p: number) => p.toFixed(prec)

      ctx.font = MONO
      const padT = 10
      const padB = 22
      const padL = 6
      let widest = 0
      for (const b of bars.slice(-40)) widest = Math.max(widest, b.high)
      const padR = Math.ceil(ctx.measureText(fmt(widest || bars[N - 1].high)).width) + 16
      const plotW = W - padL - padR
      const plotH = H - padT - padB
      if (plotW <= 4 || plotH <= 4) return

      // Resolve the visible window from the view state (default: fit ~7px bars).
      const v = viewRef.current
      if (!v.ready) {
        v.count = Math.max(MIN_BARS, Math.min(N, Math.floor(plotW / 7) || N))
        v.offset = 0
        v.ready = true
      }
      const count = Math.max(MIN_BARS, Math.min(N, Math.round(v.count)))
      const offset = Math.max(0, Math.min(N - count, Math.round(v.offset)))
      const end = N - offset
      const start = end - count
      const visible = bars.slice(start, end)
      const slot = plotW / count
      layoutRef.current = { padL, plotW, count, N }

      // Price range with padding.
      let lo = Infinity
      let hi = -Infinity
      for (const b of visible) {
        if (b.low < lo) lo = b.low
        if (b.high > hi) hi = b.high
      }
      if (!isFinite(lo) || !isFinite(hi)) return
      if (hi === lo) { hi += Math.abs(hi) * 0.001 || 1; lo -= Math.abs(lo) * 0.001 || 1 }
      const pad = (hi - lo) * 0.08
      lo -= pad
      hi += pad
      const range = hi - lo || 1
      const y = (p: number) => padT + (1 - (p - lo) / range) * plotH
      const x = (i: number) => padL + slot * i + slot / 2
      const priceAt = (yy: number) => lo + (1 - (yy - padT) / plotH) * range

      // Horizontal grid + right-side price labels.
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 1
      const levels = 5
      for (let i = 0; i <= levels; i++) {
        const p = lo + range * (i / levels)
        const yy = Math.round(y(p)) + 0.5
        ctx.strokeStyle = th.grid
        ctx.beginPath()
        ctx.moveTo(padL, yy)
        ctx.lineTo(padL + plotW, yy)
        ctx.stroke()
        ctx.fillStyle = th.text
        ctx.textAlign = 'left'
        ctx.fillText(fmt(p), padL + plotW + 6, yy)
      }

      // Vertical grid + time labels.
      ctx.textBaseline = 'top'
      ctx.textAlign = 'center'
      const step = Math.max(1, Math.ceil(visible.length / 6))
      for (let i = 0; i < visible.length; i += step) {
        const xx = Math.round(x(i)) + 0.5
        ctx.strokeStyle = th.grid
        ctx.beginPath()
        ctx.moveTo(xx, padT)
        ctx.lineTo(xx, padT + plotH)
        ctx.stroke()
        const d = new Date(visible[i].start * 1000)
        const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        ctx.fillStyle = th.text
        ctx.fillText(label, xx, padT + plotH + 5)
      }

      // Candles.
      const bodyW = Math.max(1, Math.min(slot * 0.66, 16))
      for (let i = 0; i < visible.length; i++) {
        const b = visible[i]
        const col = b.close >= b.open ? th.up : th.down
        const cx = Math.round(x(i)) + 0.5
        ctx.strokeStyle = col
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx, y(b.high))
        ctx.lineTo(cx, y(b.low))
        ctx.stroke()
        const yo = y(b.open)
        const yc = y(b.close)
        const top = Math.min(yo, yc)
        const bh = Math.max(1, Math.abs(yc - yo))
        ctx.fillStyle = col
        ctx.fillRect(Math.round(x(i) - bodyW / 2), Math.round(top), Math.round(bodyW), Math.round(bh))
      }

      // Last visible price: dashed line + colored tag on the right edge.
      const lastBar = visible[visible.length - 1]
      const price = lastBar.close
      const prev = visible.length > 1 ? visible[visible.length - 2].close : lastBar.open
      const col = price >= prev ? th.up : th.down
      const yy = Math.round(y(price)) + 0.5
      ctx.strokeStyle = col
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(padL, yy)
      ctx.lineTo(padL + plotW, yy)
      ctx.stroke()
      ctx.setLineDash([])
      const tag = fmt(price)
      const tw = ctx.measureText(tag).width
      const tagY = y(price)
      ctx.fillStyle = col
      ctx.beginPath()
      const rx = padL + plotW + 2
      ctx.roundRect(rx, tagY - 9, tw + 10, 18, 3)
      ctx.fill()
      ctx.fillStyle = th.tagText
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(tag, rx + 5, tagY + 0.5)

      // Crosshair + price/time readout under the cursor.
      const hov = hoverRef.current
      if (hov && hov.x >= padL && hov.x <= padL + plotW && hov.y >= padT && hov.y <= padT + plotH) {
        ctx.save()
        ctx.strokeStyle = th.cross
        ctx.setLineDash([3, 3])
        ctx.lineWidth = 1
        const hx = Math.round(hov.x) + 0.5
        const hy = Math.round(hov.y) + 0.5
        ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + plotH); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(padL, hy); ctx.lineTo(padL + plotW, hy); ctx.stroke()
        ctx.setLineDash([])
        // Price tag on the axis.
        const cp = fmt(priceAt(hov.y))
        const cw = ctx.measureText(cp).width
        ctx.fillStyle = themeRef.current === 'dark' ? '#2a2f3e' : '#33465a'
        ctx.beginPath(); ctx.roundRect(padL + plotW + 2, hov.y - 9, cw + 10, 18, 3); ctx.fill()
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
        ctx.fillText(cp, padL + plotW + 7, hov.y + 0.5)
        ctx.restore()
      }
    }

    drawRef.current = draw

    // ---- Interactions ----
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const L = layoutRef.current
      if (L.N <= 0) return
      const mx = Math.max(0, Math.min(L.plotW, e.offsetX - L.padL))
      const f = L.plotW > 0 ? mx / L.plotW : 1
      const v = viewRef.current
      const anchor = (L.N - Math.round(v.offset) - L.count) + f * L.count // bar index under cursor
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12
      let newCount = Math.round(L.count * factor)
      newCount = Math.max(MIN_BARS, Math.min(L.N, newCount))
      const newStart = anchor - f * newCount
      let newOffset = L.N - (newStart + newCount)
      newOffset = Math.max(0, Math.min(L.N - newCount, newOffset))
      v.count = newCount
      v.offset = newOffset
      v.ready = true
      requestDraw()
    }

    let drag: { x: number; offset: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      drag = { x: e.clientX, offset: viewRef.current.offset }
      try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      canvas.style.cursor = 'grabbing'
    }
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      hoverRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const L = layoutRef.current
      if (drag && L.count > 0) {
        const slot = L.plotW / L.count
        const dbars = (e.clientX - drag.x) / slot
        let newOffset = drag.offset + dbars
        newOffset = Math.max(0, Math.min(L.N - L.count, newOffset))
        viewRef.current.offset = newOffset
        viewRef.current.ready = true
      }
      requestDraw()
    }
    const endDrag = (e: PointerEvent) => {
      drag = null
      canvas.style.cursor = 'grab'
      try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    const onLeave = () => { hoverRef.current = null; requestDraw() }
    const onDblClick = () => { viewRef.current.ready = false; requestDraw() }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('dblclick', onDblClick)

    const ro = new ResizeObserver(() => requestDraw())
    ro.observe(wrap)
    draw()
    return () => {
      ro.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', endDrag)
      canvas.removeEventListener('pointercancel', endDrag)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('dblclick', onDblClick)
    }
  }, [])

  // Reset the zoom/pan view when the asset or timeframe changes.
  useEffect(() => {
    viewRef.current.ready = false
    const id = requestAnimationFrame(() => drawRef.current())
    return () => cancelAnimationFrame(id)
  }, [viewKey])

  // Redraw when data or theme changes.
  useEffect(() => {
    const id = requestAnimationFrame(() => drawRef.current())
    return () => cancelAnimationFrame(id)
  }, [candles, liveCandle, theme])

  return (
    <div className="chart custom-chart" ref={wrapRef}>
      <canvas ref={canvasRef} style={{ cursor: 'grab', touchAction: 'none' }} />
    </div>
  )
}
