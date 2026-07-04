/**
 * DirectionProvider — flips the whole app to RTL when language = Arabic.
 * Wraps MUI's theme (direction) + an emotion cache with the RTL stylis
 * plugin so every margin/padding/flex order mirrors automatically.
 */
import { ReactNode, useEffect, useMemo } from 'react'
import createCache from '@emotion/cache'
import { CacheProvider } from '@emotion/react'
import { ThemeProvider } from '@mui/material/styles'
import rtlPlugin from 'stylis-plugin-rtl'
// @ts-ignore — stylis ships no bundled declarations for this entry
import { prefixer } from 'stylis'
import { createAppTheme } from './theme'
import { useAppSettings } from './context/AppSettings'

const ltrCache = createCache({ key: 'mui' })
const rtlCache = createCache({ key: 'mui-rtl', stylisPlugins: [prefixer, rtlPlugin] })

export default function DirectionProvider({ children }: { children: ReactNode }) {
  const { language } = useAppSettings()
  const rtl = language === 'ar'

  useEffect(() => {
    document.documentElement.dir  = rtl ? 'rtl' : 'ltr'
    document.documentElement.lang = language
  }, [rtl, language])

  const theme = useMemo(() => createAppTheme('light', rtl ? 'rtl' : 'ltr'), [rtl])

  return (
    <CacheProvider value={rtl ? rtlCache : ltrCache}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </CacheProvider>
  )
}
