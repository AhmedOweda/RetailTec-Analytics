/**
 * AppSettings — global UI preferences stored in localStorage.
 * Currently: productCodeField ('alu' | 'upc')
 */
import { createContext, useContext, useState, ReactNode } from 'react'

export type ProductCodeField = 'alu' | 'upc'

interface AppSettings {
  productCodeField:    ProductCodeField
  setProductCodeField: (v: ProductCodeField) => void
}

const AppSettingsContext = createContext<AppSettings>({
  productCodeField:    'alu',
  setProductCodeField: () => {},
})

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [productCodeField, setFieldState] = useState<ProductCodeField>(
    () => (localStorage.getItem('productCodeField') as ProductCodeField) ?? 'alu'
  )

  const setProductCodeField = (v: ProductCodeField) => {
    localStorage.setItem('productCodeField', v)
    setFieldState(v)
  }

  return (
    <AppSettingsContext.Provider value={{ productCodeField, setProductCodeField }}>
      {children}
    </AppSettingsContext.Provider>
  )
}

export const useAppSettings = () => useContext(AppSettingsContext)
