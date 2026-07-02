/**
 * AppSettings — global UI preferences stored in localStorage.
 * - productCodeField ('alu' | 'upc')
 * - currency (display currency for money values; default Saudi Riyal with the
 *   new ⃀ symbol — the software targets the Gulf market)
 */
import { createContext, useContext, useState, ReactNode } from 'react'

export type ProductCodeField = 'alu' | 'upc'

export interface Currency { code: string; name: string; symbol: string }

// Note: SAR uses the NEW Saudi Riyal sign — U+20C1 SAUDI RIYAL SIGN
// (Unicode 17.0, Sept 2025; SAMA rules: symbol LEFT of the number + space).
// Font support is still rolling out; if it renders as a box on older fonts,
// swap in SAMA's official SVG glyph.
export const CURRENCIES: Currency[] = [
  { code: 'SAR', name: 'Saudi Riyal',    symbol: '⃁' },
  { code: 'AED', name: 'UAE Dirham',     symbol: 'د.إ' },
  { code: 'QAR', name: 'Qatari Riyal',   symbol: 'ر.ق' },
  { code: 'KWD', name: 'Kuwaiti Dinar',  symbol: 'د.ك' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'د.ب' },
  { code: 'OMR', name: 'Omani Rial',     symbol: 'ر.ع.' },
  { code: 'USD', name: 'US Dollar',      symbol: '$' },
  { code: 'EUR', name: 'Euro',           symbol: '€' },
]

interface AppSettings {
  productCodeField:    ProductCodeField
  setProductCodeField: (v: ProductCodeField) => void
  currency:            Currency
  setCurrency:         (code: string) => void
  showCurrency:        boolean
  setShowCurrency:     (v: boolean) => void
  /** '⃁ ' prefix for money values, or '' when the sign is turned off */
  moneyPrefix:         string
}

const DEFAULT_CURRENCY = CURRENCIES[0]

const AppSettingsContext = createContext<AppSettings>({
  productCodeField:    'alu',
  setProductCodeField: () => {},
  currency:            DEFAULT_CURRENCY,
  setCurrency:         () => {},
  showCurrency:        true,
  setShowCurrency:     () => {},
  moneyPrefix:         DEFAULT_CURRENCY.symbol + ' ',
})

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [productCodeField, setFieldState] = useState<ProductCodeField>(
    () => (localStorage.getItem('productCodeField') as ProductCodeField) ?? 'alu'
  )
  const [currency, setCurrencyState] = useState<Currency>(() => {
    const code = localStorage.getItem('currency')
    return CURRENCIES.find(c => c.code === code) ?? DEFAULT_CURRENCY
  })

  const setProductCodeField = (v: ProductCodeField) => {
    localStorage.setItem('productCodeField', v)
    setFieldState(v)
  }

  const [showCurrency, setShowCurrencyState] = useState<boolean>(
    () => localStorage.getItem('showCurrency') !== 'false'   // default ON
  )

  const setCurrency = (code: string) => {
    const c = CURRENCIES.find(x => x.code === code) ?? DEFAULT_CURRENCY
    localStorage.setItem('currency', c.code)
    setCurrencyState(c)
  }

  const setShowCurrency = (v: boolean) => {
    localStorage.setItem('showCurrency', String(v))
    setShowCurrencyState(v)
  }

  const moneyPrefix = showCurrency ? currency.symbol + ' ' : ''

  return (
    <AppSettingsContext.Provider value={{ productCodeField, setProductCodeField,
                                          currency, setCurrency,
                                          showCurrency, setShowCurrency, moneyPrefix }}>
      {children}
    </AppSettingsContext.Provider>
  )
}

export const useAppSettings = () => useContext(AppSettingsContext)
