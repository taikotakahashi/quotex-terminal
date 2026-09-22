import {
  quotexFlagHref,
  resolveAssetIcons,
  type IconPart,
} from '../assetIcons'

interface Props {
  symbol: string
  name?: string
  size?: 'sm' | 'md'
  className?: string
}

function PartVisual({ part }: { part: IconPart }) {
  if (part.kind === 'qx') {
    // Official Quotex sprite symbol (same artwork as qxbroker.com/profile/images/flags.svg).
    return (
      <svg className="asset-icon-svg" aria-hidden focusable="false">
        <use href={quotexFlagHref(part.id)} />
      </svg>
    )
  }
  return (
    <span className="asset-icon-glyph fallback" aria-hidden>
      {(part.label || part.id).slice(0, 2)}
    </span>
  )
}

export function AssetIcon({ symbol, name, size = 'sm', className = '' }: Props) {
  const spec = resolveAssetIcons(symbol, name)
  const parts = spec.parts
  const multi = parts.length > 1

  return (
    <span
      className={`asset-icon size-${size} ${multi ? 'pair' : 'single'} ${className}`}
      title={name || symbol}
      aria-hidden
    >
      {parts.map((part, i) => (
        <span key={`${part.kind}-${part.id}-${i}`} className={`asset-icon-disc kind-${part.kind}`}>
          <PartVisual part={part} />
        </span>
      ))}
    </span>
  )
}
