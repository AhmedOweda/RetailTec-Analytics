/**
 * i18n — English / Arabic
 * =======================
 * Language lives in AppSettings ('language': 'en' | 'ar') and drives both
 * translation AND layout direction (ar => RTL, handled by DirectionProvider).
 *
 * Coverage today: app chrome (sidebar, header, login, common buttons).
 * Page-internal strings are translated incrementally — use t('key') with an
 * English fallback so untranslated text simply stays English.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const en = {
  // Sidebar sections
  'nav.sales': 'Sales', 'nav.inventory': 'Inventory',
  'nav.purchasing': 'Purchasing', 'nav.dimensions': 'Dimensions',
  // Sidebar items (keyed by route)
  'nav./sales/overview': 'Overview', 'nav./sales/performance': 'Performance',
  'nav./sales/products': 'Products', 'nav./sales/transactions': 'Transactions',
  'nav./inventory/overview': 'Stock Levels', 'nav./inventory/movement': 'Movement',
  'nav./inventory/transfers': 'Transfers', 'nav./inventory/adjustments': 'Adjustments',
  'nav./inventory/ledger': 'Ledger', 'nav./inventory/coverage': 'Coverage',
  'nav./purchases/overview': 'Overview', 'nav./purchases/transactions': 'Transactions',
  'nav./dimensions/stores': 'Stores', 'nav./dimensions/customers': 'Customers',
  'nav./dimensions/employees': 'Employees', 'nav./dimensions/items': 'Items',
  'nav./dimensions/vendors': 'Suppliers',
  'nav./settings': 'Settings', 'nav./settings/users': 'Users',
  // Header
  'header.tagline': 'RETAIL PRO PRISM · RETAIL INTELLIGENCE',
  // Common
  'common.save': 'Save Settings',
  'common.logout': 'Log out',
  'common.language': 'Language',
}

const ar: typeof en = {
  'nav.sales': 'المبيعات', 'nav.inventory': 'المخزون',
  'nav.purchasing': 'المشتريات', 'nav.dimensions': 'البيانات الأساسية',
  'nav./sales/overview': 'نظرة عامة', 'nav./sales/performance': 'الأداء',
  'nav./sales/products': 'المنتجات', 'nav./sales/transactions': 'الفواتير',
  'nav./inventory/overview': 'مستويات المخزون', 'nav./inventory/movement': 'حركة المخزون',
  'nav./inventory/transfers': 'التحويلات', 'nav./inventory/adjustments': 'التسويات',
  'nav./inventory/ledger': 'دفتر المخزون', 'nav./inventory/coverage': 'تغطية المخزون',
  'nav./purchases/overview': 'نظرة عامة', 'nav./purchases/transactions': 'حركات الشراء',
  'nav./dimensions/stores': 'الفروع', 'nav./dimensions/customers': 'العملاء',
  'nav./dimensions/employees': 'الموظفون', 'nav./dimensions/items': 'الأصناف',
  'nav./dimensions/vendors': 'الموردون',
  'nav./settings': 'الإعدادات', 'nav./settings/users': 'المستخدمون',
  'header.tagline': 'ريتيل برو بريزم · ذكاء أعمال التجزئة',
  'common.save': 'حفظ الإعدادات',
  'common.logout': 'تسجيل الخروج',
  'common.language': 'اللغة',
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: localStorage.getItem('language') ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
