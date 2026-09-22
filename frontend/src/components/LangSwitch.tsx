import type { Lang } from '../i18n'
import { useI18n } from '../i18n'

function FlagUS() {
  return (
    <svg className="flag" viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg">
      <rect width="20" height="14" fill="#b22234" />
      <g fill="#fff">
        {[1, 3, 5, 7, 9, 11].map((i) => (
          <rect key={i} y={i * (14 / 13)} width="20" height={14 / 13} />
        ))}
      </g>
      <rect width="8.4" height={(14 / 13) * 7} fill="#3c3b6e" />
      <g fill="#fff">
        {[1.4, 4.2, 7].flatMap((cy) =>
          [1, 2.9, 4.8, 6.7].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.5" />),
        )}
      </g>
    </svg>
  )
}

function FlagBR() {
  return (
    <svg className="flag" viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg">
      <rect width="20" height="14" fill="#009c3b" />
      <polygon points="10,1.6 18,7 10,12.4 2,7" fill="#ffdf00" />
      <circle cx="10" cy="7" r="3.1" fill="#002776" />
      <path d="M7.1 6.35 A3.8 3.8 0 0 1 12.9 7.5" stroke="#fff" strokeWidth="0.7" fill="none" />
    </svg>
  )
}

function FlagES() {
  return (
    <svg className="flag" viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg">
      <rect width="20" height="14" fill="#aa151b" />
      <rect y="3.5" width="20" height="7" fill="#f1bf00" />
    </svg>
  )
}

const FLAGS: Record<Lang, () => JSX.Element> = { en: FlagUS, pt: FlagBR, es: FlagES }
const FLAG_LABEL: Record<Lang, string> = {
  en: 'English',
  pt: 'Português (Brasil)',
  es: 'Español',
}

export function LangSwitch() {
  const { lang, setLang } = useI18n()
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {(['en', 'pt', 'es'] as Lang[]).map((l) => {
        const Flag = FLAGS[l]
        return (
          <button
            key={l}
            type="button"
            className={l === lang ? 'on' : ''}
            title={FLAG_LABEL[l]}
            aria-label={FLAG_LABEL[l]}
            aria-pressed={l === lang}
            onClick={() => setLang(l)}
          >
            <Flag />
          </button>
        )
      })}
    </div>
  )
}
