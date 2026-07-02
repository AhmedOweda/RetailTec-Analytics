/**
 * AppSettings — global UI preferences stored in localStorage.
 * - productCodeField ('alu' | 'upc')
 * - currency (display currency for money values; default Saudi Riyal with the
 *   new ⃀ symbol — the software targets the Gulf market)
 */
import { createContext, useContext, useState, ReactNode } from 'react'

export type ProductCodeField = 'alu' | 'upc'

export interface Currency { code: string; name: string; symbol: string }

// Note: SAR uses the NEW Saudi Riyal sign (U+20C0), not the "SAR" code.
export const CURRENCIES: Currency[] = [
  { code: 'SAR', name: 'Saudi Riyal',    symbol: '⃀' },
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
}

const DEFAULT_CURRENCY = CURRENCIES[0]

const AppSettingsContext = createContext<AppSettings>({
  productCodeField:    'alu',
  setProductCodeField: () => {},
  currency:            DEFAULT_CURRENCY,
  setCurrency:         () => {},
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

  const setCurrency = (code: string) => {
    const c = CURRENCIES.find(x => x.code === code) ?? DEFAULT_CURRENCY
    localStorage.setItem('currency', c.code)
    setCurrencyState(c)
  }

  return (
    <AppSettingsContext.Provider value={{ productCodeField, setProductCodeField, currency, setCurrency }}>
      {children}
    </AppSettingsContext.Provider>
  )
}

export const useAppSettings = () => useContext(AppSettingsContext)
