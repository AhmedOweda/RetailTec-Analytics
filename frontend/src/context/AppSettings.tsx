/**
 * AppSettings — global UI preferences stored in localStorage.
 * - productCodeField ('alu' | 'upc')
 * - currency (display currency for money values; default Saudi Riyal with the
 *   new ⃀ symbol — the software targets the Gulf market)
 * - number format (decimals for money, K/M abbreviation)
 * - analytics thresholds (days-on-hand, dormant customers, GM% traffic lights)
 */
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import axios from 'axios'
import { setMoneyPrefixGlobal, setNumberFormatGlobal } from '../utils/formatters'
import { Thresholds, DEFAULT_THRESHOLDS, setThresholdsGlobal } from '../utils/thresholds'
import { useAuth } from '../contexts/AuthContext'

/** Which DIM_ITEM field identifies an item throughout the UI (charts, grids
 *  and — via DataSlicer — every item slicer). Configured in
 *  Settings → Data Model → Display Settings → Product Code Field. */
export type ProductCodeField = 'alu' | 'upc' | 'description'

/** The resolved identifier: the setting key, the DIM_ITEM column behind it and
 *  a display label. Pages/slicers ask THIS instead of hardcoding ALU. */
export interface ItemIdentifier {
  field:  ProductCodeField
  column: string   // 'ALU' | 'UPC' | 'DESCRIPTION1' — the DIM_ITEM column
  label:  string   // 'ALU' | 'UPC' | 'Description'  — a grid header / chip label
}

const ITEM_IDENTIFIERS: Record<ProductCodeField, ItemIdentifier> = {
  alu:         { field: 'alu',         column: 'ALU',          label: 'ALU' },
  upc:         { field: 'upc',         column: 'UPC',          label: 'UPC' },
  description: { field: 'description', column: 'DESCRIPTION1', label: 'Description' },
}

export const itemIdentifierFor = (f?: string): ItemIdentifier =>
  ITEM_IDENTIFIERS[(f as ProductCodeField)] ?? ITEM_IDENTIFIERS.alu

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
  /** Resolved form of productCodeField — ask this for the item identifier
   *  (field key / DIM_ITEM column / display label) instead of hardcoding ALU. */
  itemId:              ItemIdentifier
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
  /** UI language: 'en' | 'ar' — 'ar' also flips the whole layout to RTL */
  language:            string
  setLanguage:         (v: string) => void
  /** UI theme: 'light' | 'dark' — drives MUI palette + the data-theme attr */
  themeMode:           'light' | 'dark'
  setThemeMode:        (v: 'light' | 'dark') => void
}

const DEFAULT_CURRENCY = CURRENCIES[0]

const AppSettingsContext = createContext<AppSettings>({
  productCodeField:    'alu',
  setProductCodeField: () => {},
  itemId:              itemIdentifierFor('alu'),
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
  language:            'en',
  setLanguage:         () => {},
  themeMode:           'light',
  setThemeMode:        () => {},
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
    // Write through to the server: scheduled/emailed report attachments are
    // built server-side and read settings.json → display.item_identifier.
    // (PUT is admin-only, matching the Settings → Display page; failures are
    // non-fatal — the browser keeps working from localStorage.)
    axios.put('/api/settings/display', { item_identifier: v }).catch(() => {})
  }

  // ── Server sync: the item identifier is authoritative on the SERVER ───────
  // localStorage stays as an offline-first cache, but on load (and again on
  // login, so a fresh token can seed) we adopt the server's value. If the
  // server has never been configured, seed it once from this browser so
  // existing users keep the identifier they already chose.
  const { token, isAdmin } = useAuth()
  useEffect(() => {
    let stale = false
    axios.get('/api/settings/display')
      .then(r => {
        if (stale) return
        const v = r.data?.item_identifier
        if (v === 'alu' || v === 'upc' || v === 'description') {
          localStorage.setItem('productCodeField', v)
          setFieldState(v)
        } else if (token && isAdmin) {
          const mine = (localStorage.getItem('productCodeField') as ProductCodeField) ?? 'alu'
          axios.put('/api/settings/display', { item_identifier: mine }).catch(() => {})
        }
      })
      .catch(() => {})   // offline / server down → keep the cached value
    return () => { stale = true }
  }, [token, isAdmin])

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

  // ── Language (drives i18n + RTL direction) ─────────────────────────────────
  const [language, setLanguageState] = useState<string>(
    () => localStorage.getItem('language') ?? 'en')
  const setLanguage = (v: string) => {
    localStorage.setItem('language', v)
    setLanguageState(v)
    import('../i18n').then(m => m.default.changeLanguage(v))
  }

  // ── Theme mode (light / dark) ──────────────────────────────────────────────
  const [themeMode, setThemeState] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('themeMode') === 'dark' ? 'dark' : 'light'))
  const setThemeMode = (v: 'light' | 'dark') => {
    localStorage.setItem('themeMode', v)
    setThemeState(v)
  }
  // Reflect the mode on <html data-theme> so plain-CSS tokens flip too
  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
  }, [themeMode])

  const moneyPrefix = showCurrency ? currency.symbol + ' ' : ''

  // keep the module-level helpers (used by page formatters) in sync
  useEffect(() => { setMoneyPrefixGlobal(moneyPrefix) }, [moneyPrefix])
  useEffect(() => {
    setNumberFormatGlobal({ abbreviate: abbreviateNumbers, moneyDecimals })
  }, [abbreviateNumbers, moneyDecimals])
  useEffect(() => { setThresholdsGlobal(thresholds) }, [thresholds])

  return (
    <AppSettingsContext.Provider value={{ productCodeField, setProductCodeField,
                                          itemId: itemIdentifierFor(productCodeField),
                                          currency, setCurrency,
                                          showCurrency, setShowCurrency, moneyPrefix,
                                          moneyDecimals, setMoneyDecimals,
                                          abbreviateNumbers, setAbbreviateNumbers,
                                          thresholds, setThreshold,
                                          itemFields, setItemFields,
                                          language, setLanguage,
                                          themeMode, setThemeMode }}>
      {children}
    </AppSettingsContext.Provider>
  )
}

export const useAppSettings = () => useContext(AppSettingsContext)
