/** Decorative CSS radar — no data. */
export function SignalRadar({ tone = 'call' }: { tone?: 'call' | 'put' }) {
  return (
    <div className={`sig-radar ${tone}`} aria-hidden>
      <span className="sig-radar-glow" />
      <span className="sig-radar-ring r1" />
      <span className="sig-radar-ring r2" />
      <span className="sig-radar-ring r3" />
      <span className="sig-radar-ring r4" />
      <span className="sig-radar-cross h" />
      <span className="sig-radar-cross v" />
      <span className="sig-radar-cross d1" />
      <span className="sig-radar-cross d2" />
      <span className="sig-radar-sweep" />
      <span className="sig-radar-pulse" />
      <span className="sig-radar-dot" />
      <i className="sig-radar-blip a" />
      <i className="sig-radar-blip b" />
      <i className="sig-radar-blip c" />
      <i className="sig-radar-blip d" />
      <i className="sig-radar-blip e" />
      <i className="sig-radar-blip f" />
    </div>
  )
}
