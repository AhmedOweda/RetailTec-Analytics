/**
 * i18n — English / Arabic
 * =======================
 * Language lives in AppSettings ('language': 'en' | 'ar') and drives both
 * translation AND layout direction (ar => RTL, handled by DirectionProvider).
 *
 * Two kinds of keys:
 *   nav.* — sidebar chrome
 *   plain English strings — page titles, KPI labels, chart titles, grid
 *     headers. tr('Cost Value') returns the Arabic when the language is ar,
 *     or the string itself otherwise / when no translation exists yet.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const nav_en = {
  'nav.sales': 'Sales', 'nav.inventory': 'Inventory',
  'nav.purchasing': 'Purchasing', 'nav.dimensions': 'Dimensions',
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
}

const nav_ar = {
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
}

/* Flat English → Arabic. Missing entries simply stay English. */
const ar_strings: Record<string, string> = {
  // ── Page titles / subtitles ──
  'Stock Levels': 'مستويات المخزون',
  'Current on-hand snapshot · refreshed on each data sync': 'لقطة المخزون الحالي · تُحدَّث مع كل مزامنة',
  'Stock Movement': 'حركة المخزون',
  'Transfers': 'التحويلات',
  'Adjustments': 'التسويات',
  'Inventory Ledger': 'دفتر المخزون',
  'Inventory History': 'سجل المخزون',
  'Purchases Overview': 'نظرة عامة على المشتريات',
  'Purchase Transactions': 'حركات الشراء',
  'Products': 'المنتجات',
  'Transactions': 'الفواتير',
  'Performance': 'الأداء',
  'CRM — Customer Intelligence': 'ذكاء العملاء — CRM',
  'SRM — Supplier Intelligence': 'ذكاء الموردين — SRM',
  'Users Management': 'إدارة المستخدمين',

  // ── KPI labels ──
  'Total SKUs': 'إجمالي الأصناف', 'Units On-Hand': 'الوحدات المتوفرة',
  'Cost Value': 'قيمة التكلفة', 'Retail Value': 'قيمة البيع',
  'Potential GM': 'الهامش المتوقع', 'Inventory Turnover': 'دوران المخزون',
  'Days on Hand': 'أيام التغطية', 'Months Supply': 'أشهر التغطية',
  'COGS (12m)': 'تكلفة المبيعات (12 شهرًا)',
  'Active SKUs': 'الأصناف النشطة', 'Units Sold': 'الوحدات المباعة',
  'Daily Velocity': 'المبيعات اليومية', 'Revenue': 'الإيرادات',
  'Gross Margin': 'إجمالي الهامش',
  'Total Transfers': 'إجمالي التحويلات', 'Sent Qty': 'الكمية المرسلة',
  'Received Qty': 'الكمية المستلمة', 'Received': 'المستلم', 'Pending': 'قيد الانتظار',
  'Net Cost Impact': 'صافي أثر التكلفة', 'Net Qty Change': 'صافي تغير الكمية',
  'Sold Cost (COGS)': 'تكلفة المبيعات', 'Transfers In': 'تحويلات واردة',
  'Adj Cost Impact': 'أثر تكلفة التسويات', 'Rows in View': 'الصفوف المعروضة',
  'Total Vouchers': 'إجمالي السندات', 'Total Cost': 'إجمالي التكلفة',
  'Received Vouchers': 'السندات المستلمة', 'Pending Vouchers': 'السندات المعلقة',
  'Suppliers': 'الموردون', 'Line Items': 'عدد البنود', 'Ordered Qty': 'الكمية المطلوبة',
  'Total Retail': 'إجمالي البيع',
  'Total Events': 'إجمالي الأحداث', 'SKUs Affected': 'الأصناف المتأثرة',
  'Inserts / Updates': 'إضافات / تعديلات', 'Total Cost Value': 'إجمالي قيمة التكلفة',
  'Supplier Count': 'عدد الموردين', 'Total Purchased': 'إجمالي المشتريات',
  'Avg Fill Rate': 'متوسط نسبة التلبية', 'Top Supplier Share': 'حصة أكبر مورد',

  // ── KPI sub-lines ──
  'distinct items moved': 'أصناف مختلفة تحركت', 'units per day': 'وحدة في اليوم',
  'excl. tax': 'بدون ضريبة', 'at cost price': 'بسعر التكلفة',
  'at selling price': 'بسعر البيع', 'retail − cost margin': 'هامش البيع − التكلفة',
  'units shipped out': 'وحدات مرسلة', 'units received in': 'وحدات مستلمة',
  'value of goods moved': 'قيمة البضائع المحوّلة', 'awaiting receipt': 'بانتظار الاستلام',
  'purchase orders in period': 'أوامر شراء في الفترة',
  'sum of voucher totals': 'مجموع إجماليات السندات',
  'purchased from in period': 'تم الشراء منهم في الفترة',
  'voucher detail rows': 'بنود السندات', 'units on order': 'وحدات مطلوبة',
  'sum of line costs': 'مجموع تكاليف البنود', 'rows in current filter': 'صفوف حسب التصفية',
  'units received': 'وحدات مستلمة', 'items with movement': 'أصناف بها حركة',
  'cost of goods sold (last yr)': 'تكلفة المبيعات (آخر سنة)',
  'stock cost ÷ monthly COGS': 'تكلفة المخزون ÷ تكلفة المبيعات الشهرية',
  '365 ÷ turnover rate': '365 ÷ معدل الدوران',
  'COGS ÷ stock cost (12m)': 'تكلفة المبيعات ÷ تكلفة المخزون',
  'concentration risk': 'مخاطر التركّز',

  // ── Chart titles / subtitles ──
  'Stock by Department': 'المخزون حسب القسم',
  'DCS Hierarchy — Drill-down Sunburst': 'التسلسل الهرمي للأقسام',
  'Top Item Vendors by Stock Value': 'أعلى موردي الأصناف حسب قيمة المخزون',
  'Stock by Store': 'المخزون حسب الفرع',
  'Stock Detail': 'تفاصيل المخزون',
  'Daily Movement Trend': 'اتجاه الحركة اليومية',
  'Revenue by Department (ABC)': 'الإيرادات حسب القسم (ABC)',
  'Department Velocity': 'سرعة مبيعات الأقسام',
  'Movement Detail': 'تفاصيل الحركة',
  'Daily Transfer Trend': 'اتجاه التحويلات اليومية',
  'Status Breakdown': 'توزيع الحالات',
  'Top Sending Stores (Cost)': 'أكثر الفروع إرسالًا (تكلفة)',
  'Top Receiving Stores (Cost)': 'أكثر الفروع استلامًا (تكلفة)',
  'Daily Adjustment Trend': 'اتجاه التسويات اليومية',
  'By Adjustment Type (Net Cost $)': 'حسب نوع التسوية (صافي التكلفة)',
  'By Store (Net Cost $)': 'حسب الفرع (صافي التكلفة)',
  'Daily Purchase Trend': 'اتجاه المشتريات اليومية',
  'Top Suppliers by Cost': 'أعلى الموردين حسب التكلفة',
  'Top Departments by Cost': 'أعلى الأقسام حسب التكلفة',
  'Top Item Vendors': 'أعلى موردي الأصناف',
  'Top 15 by Lifetime Value': 'أعلى 15 حسب القيمة الدائمة',
  'Top 12 by Purchase Value': 'أعلى 12 حسب قيمة المشتريات',
  'Daily Inventory Changes': 'تغيرات المخزون اليومية',
  'Most Active Items': 'الأصناف الأكثر حركة',
  'Day of Week Pattern': 'نمط أيام الأسبوع',
  'Basket Size Distribution': 'توزيع حجم السلة',

  // ── Tabs / view chips ──
  'By Sending Store': 'حسب الفرع المرسل', 'By Receiving Store': 'حسب الفرع المستلم',
  'By Department': 'حسب القسم', 'Details': 'التفاصيل',
  'By Type': 'حسب النوع', 'By Store': 'حسب الفرع',
  'By Dept': 'حسب القسم', 'By Item': 'حسب الصنف', 'By Item Vendor': 'حسب مورد الصنف',
  'Item × Store': 'صنف × فرع', 'Top Items': 'أعلى الأصناف',
  'DCS Breakdown': 'توزيع الأقسام',

  // ── Grid headers ──
  'Description': 'الوصف', 'Department': 'القسم', 'Dept': 'القسم',
  'Store': 'الفرع', 'Stores': 'الفروع',
  'Item Vendor': 'مورد الصنف', 'Supplier': 'المورد',
  'Units': 'الوحدات', 'SKUs': 'الأصناف',
  'GM %': '% الهامش', 'GP %': '% الربح', 'GP': 'الربح', 'GP $': 'الربح',
  'Qty': 'الكمية', 'Qty Sold': 'الكمية المباعة', 'Share %': '% الحصة',
  'Date': 'التاريخ', 'Transfer #': 'رقم التحويل', 'Voucher #': 'رقم السند',
  'Status': 'الحالة', 'From Store': 'من فرع', 'To Store': 'إلى فرع',
  'Sent': 'مرسل', 'Recv': 'مستلم',
  'Unit Cost': 'تكلفة الوحدة', 'Unit Price': 'سعر الوحدة',
  'Avg Cost': 'متوسط التكلفة', 'Avg Price': 'متوسط السعر',
  'Type': 'النوع', 'Employee': 'الموظف', 'Customer': 'العميل', 'Phone': 'الهاتف',
  'Class': 'الفئة', 'Subclass': 'الفئة الفرعية', 'DCS Code': 'رمز القسم',
  'Lines': 'البنود', 'Net Qty': 'صافي الكمية',
  'CRM Segment': 'شريحة العميل', 'Home Store': 'الفرع الرئيسي',
  'Active From': 'نشط منذ', 'Days Dormant': 'أيام الخمول',
  'Lifetime Value': 'القيمة الدائمة', 'Avg Basket': 'متوسط السلة',
  'Visits': 'الزيارات', 'Tenure (d)': 'مدة التعامل (يوم)',
  'SRM Tier': 'تصنيف المورد', 'Dependency %': '% الاعتماد', 'Fill Rate %': '% التلبية',
  'Purchased': 'المشتريات', 'Vouchers': 'السندات', 'Stock Value': 'قيمة المخزون',
  'SKUs in Stock': 'أصناف بالمخزون', 'Ord Qty': 'كمية مطلوبة', 'Recv Qty': 'كمية مستلمة',
  'Events': 'الأحداث', 'Last Qty': 'آخر كمية', 'Min Qty': 'أدنى كمية', 'Range': 'المدى',
  'Adj #': 'رقم التسوية', 'Net Cost Δ': 'صافي التكلفة',
  'Open Qty': 'كمية افتتاحية', 'Open Cost': 'تكلفة افتتاحية',
  'Sold Qty': 'كمية مباعة', 'Return Qty': 'كمية مرتجعة', 'COGS': 'تكلفة المبيعات',
  'Recv Cost': 'تكلفة الوارد', 'Sent Cost': 'تكلفة الصادر',
  'Adj Qty': 'كمية التسوية', 'Adj Cost': 'تكلفة التسوية',
  'ABC': 'ABC', 'GP Tier': 'فئة الربح',

  // ── Filters / misc ──
  'All Stores': 'كل الفروع', 'All Suppliers': 'كل الموردين', 'All Status': 'كل الحالات',
  'Columns': 'الأعمدة', 'Reset Columns': 'إعادة تعيين الأعمدة',
  'Show All': 'إظهار الكل', 'Reset': 'إعادة تعيين',
  'From': 'من', 'To': 'إلى', 'Apply': 'تطبيق', 'Loading…': 'جارٍ التحميل…',
  'Search ALU / Desc': 'بحث ALU / الوصف',
  'Type 2+ chars…': 'اكتب حرفين على الأقل…', 'No match': 'لا نتائج',

  // ── Period chips (Western digits kept by request) ──
  '7D': '7 أيام', '30D': '30 يومًا', '90D': '90 يومًا',
  'MTD': 'الشهر الحالي', 'YTD': 'منذ بداية السنة',

  // ── Chart legends / series ──
  'Returns': 'المرتجعات', 'Recv Qty ': 'كمية مستلمة',
  'Total Cost ($)': 'إجمالي التكلفة', 'PO Count': 'عدد أوامر الشراء',
  'Cumulative %': 'النسبة التراكمية', 'Other': 'أخرى',
  '+ Cost': '+ تكلفة', '− Cost': '− تكلفة',
  'INS Qty': 'كمية الإضافات', 'UPD Qty': 'كمية التعديلات',

  // ── Data values shown in cells ──
  'Sale': 'بيع', 'Return': 'مرتجع', 'TOTAL': 'الإجمالي',
  'Active': 'نشط', 'Inactive': 'غير نشط',

  // ── Settings sections / buttons ──
  'Settings': 'الإعدادات',
  'Database Connection': 'اتصال قاعدة البيانات',
  'Display Settings': 'إعدادات العرض',
  'Data Model': 'نموذج البيانات',
  'Refresh Schedules & Retention': 'جداول التحديث والاحتفاظ',
  'Load a Date Range': 'تحميل فترة زمنية',
  'Loaded Data': 'البيانات المحمّلة',
  'Sync History': 'سجل المزامنة',
  'Maintenance': 'الصيانة',
  'Email (SMTP)': 'البريد الإلكتروني (SMTP)',
  'Scheduled Reports': 'التقارير المجدولة',
  'Save Settings': 'حفظ الإعدادات',
  'View full history': 'عرض السجل الكامل',

  // ── Users page ──
  'Add User': 'إضافة مستخدم', 'User': 'المستخدم', 'Role': 'الدور',
  'Pages': 'الصفحات', 'Created': 'تاريخ الإنشاء', 'Actions': 'إجراءات',
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { ...nav_en } },
    ar: { translation: { ...nav_ar, ...ar_strings } },
  },
  lng: localStorage.getItem('language') ?? 'en',
  fallbackLng: 'en',
  keySeparator: false,   // plain-English keys contain dots/spaces
  nsSeparator: false,
  interpolation: { escapeValue: false },
})

/** Translate a plain-English UI string; returns it unchanged when the
 *  language is English or no Arabic entry exists yet. */
export function tr(s?: string): string {
  if (!s) return s ?? ''
  if (i18n.language !== 'ar') return s
  return (i18n.t(s) as string) || s
}

/** Translate AG Grid column headers (headerName) in a colDefs array. */
export function trCols<T extends { headerName?: string }>(cols: T[]): T[] {
  if (i18n.language !== 'ar') return cols
  return cols.map(c => c.headerName ? { ...c, headerName: tr(c.headerName) } : c)
}

export default i18n
