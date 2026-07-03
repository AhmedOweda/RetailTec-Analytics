/**
 * AppSettings — global UI preferences stored in localStorage.
 * - productCodeField ('alu' | 'upc')
 * - currency (display currency for money values; default Saudi Riyal with the
 *   new ⃀ symbol — the software targets the Gulf market)
 * - number format (decimals for money, K/M abbreviation)
 * - analytics thresholds (days-on-hand, dormant customers, GM% traffic lights)
 */
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { setMoneyPrefixGlobal, setNumberFormatGlobal } from '../utils/formatters'
import { Thresholds, DEFAULT_THRESHOLDS, setThresholdsGlobal } from '../utils/thresholds'

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
  moneyDecimals:       number
  setMoneyDecimals:    (v: number) => void
  abbreviateNumbers:   boolean
  setAbbreviateNumbers:(v: boolean) => void
  thresholds:          Thresholds
  setThreshold:        (patch: Partial<Thresholds>) => void
  /** DIM_ITEM columns to add to every item grid (keys from utils/itemFields) */
  itemFields:          string[]
  setItemFields:       (v: string[]) => void
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
  moneyDecimals:       0,
  setMoneyDecimals:    () => {},
  abbreviateNumbers:   true,
  setAbbreviateNumbers:() => {},
  thresholds:          DEFAULT_THRESHOLDS,
  setThreshold:        () => {},
  itemFields:          [],
  setItemFields:       () => {},
})

function loadThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem('thresholds')
    if (raw) return { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_THRESHOLDS }
}

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

  // ── Number format ──────────────────────────────────────────────────────────
  const [moneyDecimals, setMoneyDecState] = useState<number>(
    () => Number(localStorage.getItem('moneyDecimals') ?? 0)
  )
  const [abbreviateNumbers, setAbbrevState] = useState<boolean>(
    () => localStorage.getItem('abbreviateNumbers') !== 'false'   // default ON
  )
  const setMoneyDecimals = (v: number) => {
    localStorage.setItem('moneyDecimals', String(v)); setMoneyDecState(v)
  }
  const setAbbreviateNumbers = (v: boolean) => {
    localStorage.setItem('abbreviateNumbers', String(v)); setAbbrevState(v)
  }

  // ── Analytics thresholds ───────────────────────────────────────────────────
  const [thresholds, setThresholdsState] = useState<Thresholds>(loadThresholds)
  const setThreshold = (patch: Partial<Thresholds>) => {
    setThresholdsState(prev => {
      const next = { ...prev, ...patch }
      localStorage.setItem('thresholds', JSON.stringify(next))
      return next
    })
  }

  // ── Item-master grid fields ────────────────────────────────────────────────
  const [itemFields, setItemFieldsState] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('itemFields') ?? '[]') }
    catch { return [] }
  })
  const setItemFields = (v: string[]) => {
    localStorage.setItem('itemFields', JSON.stringify(v)); setItemFieldsState(v)
  }

  const moneyPrefix = showCurrency ? currency.symbol + ' ' : ''

  // keep the module-level helpers (used by page formatters) in sync
  useEffect(() => { setMoneyPrefixGlobal(moneyPrefix) }, [moneyPrefix])
  useEffect(() => {
    setNumberFormatGlobal({ abbreviate: abbreviateNumbers, moneyDecimals })
  }, [abbreviateNumbers, moneyDecimals])
  useEffect(() => { setThresholdsGlobal(thresholds) }, [thresholds])

  return (
    <AppSettingsContext.Provider value={{ productCodeField, setProductCodeField,
                                          currency, setCurrency,
                                          showCurrency, setShowCurrency, moneyPrefix,
                                          moneyDecimals, setMoneyDecimals,
                                          abbreviateNumbers, setAbbreviateNumbers,
                                          thresholds, setThreshold,
                                          itemFields, setItemFields }}>
      {children}
    </AppSettingsContext.Provider>
  )
}

export const useAppSettings = () => useContext(AppSettingsContext)
