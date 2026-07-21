/**
 * Shared AG Grid chrome localisation (ONE copy — never per-page).
 * ===============================================================
 * Covers the grid's own UI text: the paging panel (Page Size / 1 to 100 of n),
 * the column-filter popups, and the built-in overlays. Column HEADERS are
 * translated separately via trCols() in i18n.ts; the branded no-rows overlay
 * stays in gridOverlay.ts.
 *
 * Call gridLocaleText() at render time (same convention as noRowsOverlay()):
 * it returns the Arabic map when the language is Arabic, and undefined
 * otherwise so English grids keep AG Grid's built-in strings untouched.
 * Numbers stay Western digits — only the words are translated.
 */
import i18n from '../i18n'

const AR_GRID_LOCALE: Record<string, string> = {
  // ── Paging panel ──
  page: 'صفحة',
  to: 'إلى',
  of: 'من',
  firstPage: 'الصفحة الأولى',
  previousPage: 'الصفحة السابقة',
  nextPage: 'الصفحة التالية',
  lastPage: 'الصفحة الأخيرة',
  pageSizeSelectorLabel: 'حجم الصفحة:',
  // ── Overlays ──
  loadingOoo: 'جارٍ التحميل…',
  noRowsToShow: 'لا توجد بيانات',
  // ── Column filter popup ──
  filterOoo: 'تصفية…',
  searchOoo: 'بحث…',
  blanks: '(فارغ)',
  selectAll: '(تحديد الكل)',
  noMatches: 'لا توجد نتائج',
  equals: 'يساوي',
  notEqual: 'لا يساوي',
  blank: 'فارغ',
  notBlank: 'غير فارغ',
  empty: 'اختر قيمة',
  lessThan: 'أقل من',
  greaterThan: 'أكبر من',
  lessThanOrEqual: 'أقل من أو يساوي',
  greaterThanOrEqual: 'أكبر من أو يساوي',
  inRange: 'ضمن النطاق',
  inRangeStart: 'من',
  inRangeEnd: 'إلى',
  contains: 'يحتوي على',
  notContains: 'لا يحتوي على',
  startsWith: 'يبدأ بـ',
  endsWith: 'ينتهي بـ',
  dateFormatOoo: 'yyyy-mm-dd',
  before: 'قبل',
  after: 'بعد',
  andCondition: 'و',
  orCondition: 'أو',
  applyFilter: 'تطبيق',
  resetFilter: 'إعادة تعيين',
  clearFilter: 'مسح',
  cancelFilter: 'إلغاء',
  // ── Misc chrome ──
  pinColumn: 'تثبيت العمود',
  autosizeThiscolumn: 'ملاءمة عرض هذا العمود',
  autosizeAllColumns: 'ملاءمة عرض كل الأعمدة',
  resetColumns: 'إعادة تعيين الأعمدة',
  copy: 'نسخ',
  copyWithHeaders: 'نسخ مع العناوين',
  paste: 'لصق',
  export: 'تصدير',
  csvExport: 'تصدير CSV',
  excelExport: 'تصدير Excel',
  sortAscending: 'ترتيب تصاعدي',
  sortDescending: 'ترتيب تنازلي',
  sortUnSort: 'إلغاء الترتيب',
}

/** AG Grid localeText for the current language — undefined keeps English. */
export function gridLocaleText(): Record<string, string> | undefined {
  return i18n.language === 'ar' ? AR_GRID_LOCALE : undefined
}
