import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'

interface Ctx {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<Ctx>({ theme: 'dark', setTheme: () => {}, toggle: () => {} })

function readTheme(): Theme {
  try {
    const v = localStorage.getItem('qx_theme')
    if (v === 'dark' || v === 'light') return v
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
  } catch {
    /* ignore */
  }
  return 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('qx_theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  const setTheme = (t: Theme) => setThemeState(t)
  const toggle = () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark'))
  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
