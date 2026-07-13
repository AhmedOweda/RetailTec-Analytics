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
  'nav./settings/audit': 'Audit Log',
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
  'nav./settings/audit': 'سجل التدقيق',
}

/* Flat English → Arabic. Missing entries simply stay English. */
const ar_strings: Record<string, string> = {
  // ── Grid empty state ──
  'No data to display': 'لا توجد بيانات',
  // ── Page titles / subtitles ──
  'Stock Levels': 'مستويات المخزون',
  'Current on-hand snapshot · refreshed on each data sync': 'لقطة المخزون الحالي · تُحدَّث مع كل مزامنة',
  'Stock Movement': 'حركة المخزون',
  'Transfers': 'التحويلات',
  'Adjustments': 'التسويات',
  'Inventory Ledger': 'دفتر المخزون',
  'Inventory History': 'سجل المخزون',
  'Stock by Date': 'المخزون بتاريخ',
  'As of': 'حتى تاريخ',
  'Group by': 'تجميع حسب',
  'Item': 'صنف',
  'Search item': 'بحث عن صنف',
  'Stock on': 'المخزون في',
  'rows': 'صف',
  'SKUs in Stock': 'أصناف بالمخزون',
  'Stock Value (Cost)': 'قيمة المخزون (تكلفة)',
  'Negative Lines': 'سطور سالبة',
  'Inventory history starts on': 'يبدأ سجل المخزون في',
  'stock before this date is not available': 'المخزون قبل هذا التاريخ غير متاح',
  'History': 'السجل',
  'Inserts': 'إدراجات',
  'Updates': 'تحديثات',
  'SKUs Touched': 'أصناف متأثرة',
  'Item-Store Pairs': 'أزواج صنف-متجر',
  'Stock at End': 'المخزون في النهاية',
  'Value at End': 'القيمة في النهاية',
  'First Event': 'أول حركة',
  'Last Event': 'آخر حركة',

  // ── AI Assistant (Data Analyst) ──
  'Data Analyst': 'محلّل البيانات',
  'Ask AI': 'اسأل الذكاء الاصطناعي',
  'Your data analyst — ask anything about sales, stock and purchases.': 'محلّل بياناتك — اسأل أي شيء عن المبيعات والمخزون والمشتريات.',
  'AI Assistant': 'المساعد الذكي',
  'AI Assistant Settings': 'إعدادات المساعد الذكي',
  'Beta': 'تجريبي',
  'The AI assistant is off. Configure a provider to turn it on.': 'المساعد الذكي متوقف. اضبط مزوّدًا لتفعيله.',
  'The AI assistant is not enabled. Ask your administrator to turn it on.': 'المساعد الذكي غير مُفعّل. اطلب من المسؤول تفعيله.',
  'Set up': 'إعداد',
  'What would you like to know?': 'ماذا تريد أن تعرف؟',
  'Ask in plain language — the assistant writes the query, runs it on your data, and explains the answer.': 'اسأل بلغة عادية — يكتب المساعد الاستعلام، ينفّذه على بياناتك، ويشرح الإجابة.',
  'What were my top 10 products by revenue last month?': 'ما أفضل ١٠ منتجات من حيث الإيراد الشهر الماضي؟',
  'Which store had the highest sales this year?': 'أي فرع حقّق أعلى مبيعات هذا العام؟',
  'Show total stock value by department.': 'أظهر إجمالي قيمة المخزون حسب القسم.',
  'Which items have negative stock right now?': 'أي أصناف لديها مخزون سالب الآن؟',
  'Compare this month’s sales to last month.': 'قارن مبيعات هذا الشهر بالشهر الماضي.',
  'Analysing your data…': 'جارٍ تحليل بياناتك…',
  'Thinking…': 'جارٍ التفكير…',
  'View query': 'عرض الاستعلام',
  'Hide query': 'إخفاء الاستعلام',
  'Ask a question about your data…': 'اطرح سؤالًا عن بياناتك…',
  'Answers come from your live data. Always verify important numbers — AI can make mistakes.': 'الإجابات مبنية على بياناتك الحيّة. تحقّق دائمًا من الأرقام المهمة — قد يخطئ الذكاء الاصطناعي.',
  'Showing first rows only — refine your question for a smaller result.': 'عرض الصفوف الأولى فقط — حسّن سؤالك للحصول على نتيجة أصغر.',
  'Choose where the AI runs and connect it.': 'اختر مكان تشغيل الذكاء الاصطناعي واربطه.',
  'Enable the AI assistant': 'تفعيل المساعد الذكي',
  'Provider': 'المزوّد',
  'Local (Ollama) — fully offline': 'محلي (Ollama) — بلا إنترنت',
  'Local (Ollama)': 'محلي (Ollama)',
  'Google Gemini': 'جوجل Gemini',
  'Claude (Anthropic)': 'كلود (Anthropic)',
  'OpenAI-compatible': 'متوافق مع OpenAI',
  'cloud': 'سحابي',
  'Free': 'مجاني',
  'Offline': 'بلا إنترنت',
  'Ollama endpoint': 'عنوان Ollama',
  'API base URL': 'عنوان الواجهة (API)',
  'Model': 'النموذج',
  'Leave blank to use the default:': 'اتركه فارغًا لاستخدام الافتراضي:',
  'API key': 'مفتاح API',
  '(stored)': '(محفوظ)',
  'Stored encrypted on this machine. Leave blank to keep the current key.': 'يُحفظ مشفّرًا على هذا الجهاز. اتركه فارغًا للإبقاء على المفتاح الحالي.',
  'Cloud providers need internet. Your question and the data schema are sent to the provider; row data stays local except a small preview used to phrase the answer.': 'المزوّدون السحابيون يحتاجون إنترنت. يُرسَل سؤالك وبنية البيانات إلى المزوّد؛ وتبقى بيانات الصفوف محليًا عدا معاينة صغيرة لصياغة الإجابة.',
  'Fast, free. Get a key at console.groq.com': 'سريع ومجاني. احصل على مفتاح من console.groq.com',
  'Free tier. Get a key at aistudio.google.com': 'باقة مجانية. احصل على مفتاح من aistudio.google.com',
  'Highest quality. Paid API key.': 'أعلى جودة. مفتاح API مدفوع.',
  'OpenAI, OpenRouter, Azure, LM Studio…': 'OpenAI أو OpenRouter أو Azure أو LM Studio…',
  'Runs on this machine, no internet. Install Ollama + pull a model.': 'يعمل على هذا الجهاز بلا إنترنت. ثبّت Ollama واسحب نموذجًا.',

  // ── Server browse dialog / license path ──
  'Choose a folder on the server': 'اختر مجلدًا على الخادم',
  'Choose a backup file on the server': 'اختر ملف نسخة احتياطية على الخادم',
  'This PC (drives)': 'هذا الجهاز (الأقراص)',
  'Nothing to show here.': 'لا شيء لعرضه هنا.',
  'Use this folder': 'استخدم هذا المجلد',
  'License File': 'ملف الترخيص',
  ' (found)': ' (موجود)',
  ' (put license.json here)': ' (ضع license.json هنا)',
  'Purchases Overview': 'نظرة عامة على المشتريات',
  'Purchase Transactions': 'حركات الشراء',
  'Products': 'المنتجات',
  'Transactions': 'الفواتير',
  'Transactions Report': 'تقرير الفواتير',
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
  'Total Vouchers': 'إجمالي أذونات الاستلام', 'Total Cost': 'إجمالي التكلفة',
  'Received Vouchers': 'أذونات مُستلمة', 'Pending Vouchers': 'أذونات معلّقة',
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
  'sum of voucher totals': 'مجموع إجماليات الأذونات',
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
  'DCS Hierarchy — Treemap': 'التسلسل الهرمي للأقسام — خريطة شجرية',
  'Dept › Class › Subclass · click a box to drill down · breadcrumb to go back':
    'قسم › فئة › فئة فرعية · انقر على المربع للتعمق · مسار التنقل للرجوع',
  'Department Cost vs Margin': 'تكلفة القسم مقابل الهامش',
  'x = cost value · y = GM% · bubble size = units on-hand · colour = margin tier':
    'المحور الأفقي = قيمة التكلفة · العمودي = نسبة الهامش · حجم الفقاعة = الوحدات المتوفرة · اللون = فئة الهامش',
  'Top Departments by Revenue': 'أعلى الأقسام حسب الإيرادات',
  'Department Margin vs Volume': 'هامش الأقسام مقابل الحجم',
  'Revenue × GP% · bubble size = units sold': 'الإيرادات × نسبة الربح · حجم الفقاعة = عدد الوحدات المباعة',
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
  'PO Status Split': 'توزيع حالات أوامر الشراء',
  'Cost by Store': 'التكلفة حسب الفرع',
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
  'Date': 'التاريخ', 'Transfer #': 'رقم التحويل', 'Voucher #': 'رقم أذن الاستلام',
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
  'Purchased': 'المشتريات', 'Vouchers': 'أذونات الاستلام', 'Stock Value': 'قيمة المخزون',
  'Voucher': 'أذن استلام', 'Slip': 'أذن صرف',
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
  // Settings tab labels
  'Connection & Data': 'الاتصال والبيانات',
  'Schedules': 'الجداول',
  'Display': 'العرض',
  'Reports': 'التقارير',
  // About / Diagnostics panel
  'About & Diagnostics': 'حول والتشخيص',
  'App Version': 'إصدار التطبيق',
  'Schema Version': 'إصدار المخطط',
  'Last Sync': 'آخر مزامنة',
  'Warehouse Size': 'حجم المستودع',
  'Fact Rows': 'صفوف الحقائق',
  'License Customer': 'عميل الترخيص',
  'License Expiry': 'انتهاء الترخيص',
  'License Status': 'حالة الترخيص',
  'No license file': 'لا يوجد ملف ترخيص',
  'Invalid signature': 'توقيع غير صالح',
  'Expired': 'منتهي',
  '{{n}} days remaining': 'متبقٍ {{n}} يومًا',
  'Copy diagnostics': 'نسخ التشخيص',
  'Copied!': 'تم النسخ',
  // Branding (whitelabel)
  'Branding': 'العلامة التجارية',
  'Override the product name and logo shown in the header and sidebar. Leave blank to use the RetailTec defaults. Saved with Save Settings.':
    'تجاوز اسم المنتج والشعار الظاهرين في الرأس والشريط الجانبي. اتركه فارغًا لاستخدام إعدادات ريتيل تك الافتراضية. يُحفظ مع حفظ الإعدادات.',
  'Logo': 'الشعار',
  'Default logo': 'الشعار الافتراضي',
  'Upload': 'رفع',
  'Remove': 'إزالة',
  // Automatic maintenance
  'Automatic Maintenance': 'الصيانة التلقائية',
  'Weekly automatic maintenance': 'صيانة تلقائية أسبوعية',
  'Monthly backups to keep': 'عدد النسخ الاحتياطية الشهرية المحتفظ بها',
  'A backup runs monthly; older backups beyond this count are deleted.':
    'تُنشأ نسخة احتياطية شهريًا، وتُحذف النسخ الأقدم بعد هذا العدد.',
  'Runs a weekly CHECKPOINT to flush pending writes and reclaim space. Safe to leave on. Remember to Save Settings.':
    'تشغّل نقطة تحقق أسبوعية لتفريغ الكتابات المعلّقة واستعادة المساحة. آمنة لتركها مفعّلة. تذكّر حفظ الإعدادات.',
  // First-run wizard
  'Welcome to RetailTec Analytics': 'مرحبًا بك في ريتيل تك أناليتكس',
  'Connect your Retail Pro Oracle database and load the first history window. You can change everything later in Settings.':
    'اربط قاعدة بيانات ريتيل برو أوراكل وحمّل أول نافذة تاريخية. يمكنك تغيير كل شيء لاحقًا من الإعدادات.',
  'Connect Oracle': 'ربط أوراكل',
  'Test': 'اختبار',
  'History window': 'النافذة التاريخية',
  'Load': 'تحميل',
  'Connected': 'تم الاتصال',
  'Load failed': 'فشل التحميل',
  'Initial load started — you can follow progress in Settings.': 'بدأ التحميل الأولي — يمكنك متابعة التقدم من الإعدادات.',
  'Ready to load. This runs in the background and may take a while for large databases.':
    'جاهز للتحميل. يعمل في الخلفية وقد يستغرق وقتًا لقواعد البيانات الكبيرة.',
  'Skip for now': 'تخطٍ الآن',
  'Next': 'التالي',
  'Load Now': 'حمّل الآن',
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

  // ── Chart subtitles ("comments") ──
  'Ranked by revenue · GP% coloured green (healthy) / amber / red (low)':
    'مرتبة حسب الإيرادات · نسبة الربح ملوّنة أخضر (جيدة) / كهرماني / أحمر (منخفضة)',
  'Block size = cost value · colour = dept': 'حجم المربع = قيمة التكلفة · اللون = القسم',
  'Dept › Class › Subclass · click a department to zoom in (labels get readable) · click centre to go back · hover for details':
    'قسم › فئة › فئة فرعية · انقر على قسم للتكبير · انقر على المركز للرجوع · مرّر المؤشر للتفاصيل',
  'Item-master (catalog) vendor · cost value · GM% annotated': 'مورد الصنف (الكتالوج) · قيمة التكلفة · مع نسبة الهامش',
  'Cost value distribution': 'توزيع قيمة التكلفة',
  'Units sold & returns over time': 'الوحدات المباعة والمرتجعات عبر الزمن',
  'Pareto · dashed line = 80% threshold': 'باريتو · الخط المتقطع = حد 80%',
  'Revenue · GM% annotated · sorted by revenue': 'الإيرادات · مع نسبة الهامش · مرتبة حسب الإيراد',
  'Item-master (catalog) vendor · revenue ranking · GP% annotated': 'مورد الصنف (الكتالوج) · ترتيب حسب الإيراد · مع نسبة الربح',
  'Supplier on the purchase voucher': 'المورد في سند الشراء',
  'Bar colour = SRM tier': 'لون العمود = تصنيف المورد',
  'Bar colour = CRM segment': 'لون العمود = شريحة العميل',
  'Revenue ranking · GP% annotated on each bar': 'ترتيب حسب الإيراد · نسبة الربح على كل عمود',

  // ── Sales Overview page ──
  'Today': 'اليوم', 'Yesterday': 'أمس', '2 days ago': 'قبل يومين',
  'Month to Date': 'الشهر حتى تاريخه', 'Year to Date': 'السنة حتى تاريخها',
  'Last Month': 'الشهر الماضي', 'Last Year': 'السنة الماضية',
  'Sales Trend': 'اتجاه المبيعات', 'No prior data': 'لا بيانات سابقة',
  'Incl. Tax': 'شامل الضريبة', 'Tax Amount': 'قيمة الضريبة', 'Avg Ticket': 'متوسط الفاتورة',
  'Top Products (7D)': 'أعلى المنتجات (7 أيام)',
  'MTD vs Last Month': 'الشهر الحالي مقابل الماضي',
  'Top Associates (MTD)': 'أفضل البائعين (الشهر)',
  'Cumulative net sales · day by day': 'صافي مبيعات تراكمي · يومًا بيوم',
  'Net sales · month to date': 'صافي المبيعات · الشهر حتى تاريخه',
  'Sales Overview': 'نظرة عامة على المبيعات',
  'Net Sales (excl. tax)': 'صافي المبيعات (بدون ضريبة)',
  'This Month': 'الشهر الحالي',
  'Invoices': 'الفواتير', 'Discount': 'الخصم',
  'Revenue by item': 'الإيرادات حسب الصنف',
  'Net sales · invoices · return rate by day': 'صافي المبيعات · الفواتير · نسبة المرتجعات باليوم',
  'vs': 'مقابل',
  'Sold': 'المباع', 'Returned': 'المرتجع',
  'Net Sales': 'صافي المبيعات', 'Return Rate %': 'نسبة المرتجعات %',
  // ── Performance grids / charts ──
  'Associate': 'البائع', 'Disc %': 'الخصم %', 'Return %': 'المرتجعات %',
  'Net Spend': 'صافي الإنفاق', 'Last Visit': 'آخر زيارة',
  'Cash': 'نقدًا', 'Card': 'بطاقة', 'Deposit': 'عربون', 'No data': 'لا بيانات',
  'Current Period': 'الفترة الحالية', 'Same Period LY': 'نفس الفترة العام الماضي',
  '{{n}} stores': '{{n}} فروع',
  // ── Products page ──
  'Departments': 'الأقسام', 'active in period': 'نشط في الفترة',
  '% Blended GP': '% إجمالي الربح المخلوط', 'Healthy margin': 'هامش صحي',
  'Total GP': 'إجمالي الربح', 'Total Revenue': 'إجمالي الإيرادات',
  'Revenue by Department': 'الإيرادات حسب القسم',
  'Block size = revenue · hover for GP%': 'حجم المربع = الإيراد · مرّر للربح %',
  'Department › Class › Subclass · click segment to drill down · click centre to go up':
    'القسم › الفئة › الفئة الفرعية · انقر على الجزء للتفصيل · انقر على المركز للرجوع',
  'Department Hierarchy': 'التسلسل الهرمي للأقسام',
  'Showing': 'يعرض', 'code · change in Settings': 'الرمز · يتغير من الإعدادات',
  'Blended GP %': 'نسبة الربح الإجمالية %',
  'Excellent margin': 'هامش ممتاز', 'Low margin': 'هامش منخفض',
  'DCS = Department · Class · Subclass': 'DCS = قسم · فئة · فئة فرعية',
  // ── Transactions page ──
  'Doc No': 'رقم المستند', 'Tax': 'الضريبة', 'Total W/Tax': 'الإجمالي مع الضريبة',
  'Quick search…': 'بحث سريع…',
  'Export PNG': 'تصدير PNG', 'Fullscreen': 'ملء الشاشة',
  // ── Stores page ──
  'Active Stores': 'الفروع النشطة', 'Period Revenue': 'إيرادات الفترة',
  'Lifetime Revenue': 'الإيرادات التراكمية', 'Avg Return Rate': 'متوسط نسبة المرتجعات',
  'all-time chain total': 'إجمالي السلسلة منذ البداية',
  'Revenue Ranking by Store': 'ترتيب الإيرادات حسب الفرع',
  'Bar colour = lifecycle stage': 'لون العمود = مرحلة دورة الحياة',
  'Store Detail — {{n}} stores': 'تفاصيل الفروع — {{n}} فرعًا',
  'Stage': 'المرحلة', 'Days Active': 'أيام النشاط',
  'Chain Share %': 'حصة السلسلة %', 'Lifetime Rev': 'الإيراد التراكمي',
  'Mature': 'ناضج', 'Growing': 'في نمو', 'New': 'جديد',
  // ── Customers (CRM) page ──
  'At Risk + Dormant': 'معرّض للفقد + خامل', 'of base {{n}}%': '{{n}}% من القاعدة',
  'Avg LTV / Customer': 'متوسط القيمة الدائمة للعميل', 'Total LTV': 'إجمالي القيمة الدائمة',
  'all-time lifetime value': 'القيمة الدائمة منذ البداية', 'Total Customers': 'إجمالي العملاء',
  'Customer Detail — {{n}} customers': 'تفاصيل العملاء — {{n}} عميلًا',
  'Dormant': 'خامل', 'At Risk': 'معرّض للفقد',
  'Loyal': 'وفيّ', 'Champion': 'مميز',
  // ── Employees page ──
  'Top Performer': 'الأفضل أداءً', '% Avg Disc': '% متوسط الخصم',
  'Avg Rev / Invoice': 'متوسط الإيراد للفاتورة', 'team productivity index': 'مؤشر إنتاجية الفريق',
  'Head Count': 'عدد الموظفين', 'Below': 'دون المتوسط', 'Average': 'متوسط',
  'Good': 'جيد', 'Top': 'الأعلى',
  'Revenue Ranking — Top 12': 'ترتيب الإيرادات — أفضل 12',
  'Bar colour = performance tier vs team average': 'لون العمود = فئة الأداء مقابل متوسط الفريق',
  'Associate Detail — {{n}}': 'تفاصيل البائعين — {{n}}',
  'Rev / Invoice': 'الإيراد / فاتورة', 'Avg Disc %': 'متوسط الخصم %',
  '{{n}}% of base': '{{n}}% من القاعدة', '{{n}}% of portfolio': '{{n}}% من المحفظة',
  'vs team avg rev/invoice': 'مقابل متوسط الإيراد للفاتورة',
  'All stores': 'كل الفروع',
  // ── Items page ──
  'Item / SKU Intelligence': 'ذكاء الأصناف',
  'Loss-Making SKUs': 'أصناف خاسرة', 'of portfolio {{n}}%': '{{n}}% من المحفظة',
  '% Avg GP': '% متوسط الربح', 'Avg GP %': 'متوسط الربح %',
  'Top 15 SKUs by Revenue': 'أعلى 15 صنفًا حسب الإيراد',
  'Bar colour = GP tier': 'لون العمود = فئة الربح',
  'Item Detail — {{n}} SKUs': 'تفاصيل الأصناف — {{n}} صنفًا',
  'Loss': 'خاسر', 'Low Margin': 'هامش منخفض', 'Standard': 'قياسي', 'Premium': 'مرتفع الربح',
  // ── Vendors (SRM) page ──
  'Ranked by purchase vouchers (supplier bought from) — item catalogs elsewhere use the item-master vendor':
    'مرتب حسب سندات الشراء (المورد الذي تم الشراء منه) — بقية الصفحات تستخدم مورد الصنف من ملف الأصناف',
  'Supplier Detail — {{n}} suppliers': 'تفاصيل الموردين — {{n}} موردًا',
  'Preferred': 'مفضل', 'Strategic': 'استراتيجي',
  // ── Purchases overview leftovers ──
  'Cost': 'التكلفة', 'POs': 'أوامر الشراء',
  'of total {{n}}%': '{{n}}% من الإجمالي',
  '{{n}}% of total': '{{n}}% من الإجمالي', 'Disc: {{v}}': 'الخصم: {{v}}',
  // ── Settings page ──
  'Manage database connection, data refresh, display, reports and maintenance.':
    'إدارة اتصال قاعدة البيانات وتحديث البيانات والعرض والتقارير والصيانة.',
  'Refresh Dimensions only': 'تحديث الأبعاد فقط',
  'Database Alias': 'الاسم المستعار لقاعدة البيانات',
  'e.g. Main Branch DB': 'مثال: قاعدة الفرع الرئيسي',
  // ── Unified Your Data settings (2026-07-08) ──
  'Sync': 'المزامنة',
  'Your Data': 'بياناتك',
  'Each data type in one row: switch it on or off, choose how much history to keep, how it refreshes automatically, and how long line-level detail is kept (daily summaries are kept forever). Load now pulls just that data type. Times use the timezone above. Remember to Save Settings.':
    'كل نوع بيانات في صف واحد: فعّله أو أوقفه، واختر مقدار التاريخ المحتفظ به، وطريقة التحديث التلقائي، ومدة الاحتفاظ بتفاصيل الأسطر (الملخصات اليومية تبقى دائمًا). زر التحميل الآن يجلب هذا النوع فقط. الأوقات حسب المنطقة الزمنية أعلاه. لا تنسَ حفظ الإعدادات.',
  'Data type': 'نوع البيانات',
  'Domain': 'النطاق',
  'Your data': 'بياناتك',
  'Everything about each data type in one row — how much history to keep, how it refreshes, and when old line-detail is cleaned up. Daily summaries are kept forever. Remember to Save Settings.':
    'كل ما يخص كل نوع بيانات في صف واحد — مقدار التاريخ المحتفظ به، وطريقة التحديث، ومتى تُنظّف تفاصيل الأسطر القديمة. الملخصات اليومية تبقى دائمًا. لا تنسَ حفظ الإعدادات.',
  'On': 'مفعّل', 'Off': 'موقوف',
  'Timezone:': 'المنطقة الزمنية:', 'Re-check last:': 'إعادة فحص آخر:', 'Quiet hours:': 'ساعات الهدوء:',
  '{{n}} days': '{{n}} يومًا', 'off': 'موقوفة',
  'Daily {{t}}': 'يوميًا {{t}}',
  'Load a date range…': 'تحميل فترة محددة…',
  'Server online': 'الخادم يعمل',
  'UNLICENSED COPY': 'نسخة غير مرخصة',
  'INVALID LICENSE': 'ترخيص غير صالح',
  'LICENSE EXPIRED': 'انتهى الترخيص',
  'WRONG DEVICE': 'جهاز غير مرخص',
  'WRONG SERVER': 'خادم غير مرخص',
  'No license installed — evaluation mode': 'لا يوجد ترخيص — وضع التجربة',
  'Device Code': 'رمز الجهاز',
  'Server not reachable — is RetailTec Analytics running?': 'تعذّر الوصول إلى الخادم — هل تطبيق ريتيل تك يعمل؟',
  'Checking server…': 'جارٍ فحص الخادم…',
  'Cannot reach the server — it may still be starting. Try again in a moment.':
    'تعذّر الوصول إلى الخادم — قد يكون في طور التشغيل. حاول مجددًا بعد لحظات.',
  'Server error — please try again.': 'خطأ في الخادم — حاول مرة أخرى.',
  'Host changed — switched to that server\'s database.': 'تم تغيير الخادم — جرى التحويل إلى قاعدة بيانات ذلك الخادم.',
  'Last 30 days': 'آخر 30 يومًا', 'Last 3 months': 'آخر 3 أشهر', 'Last 6 months': 'آخر 6 أشهر',
  'Last 1 year': 'آخر سنة', 'Last 2 years': 'آخر سنتين', 'Last 3 years': 'آخر 3 سنوات',
  'Keep history': 'الاحتفاظ بالتاريخ',
  'Auto refresh': 'تحديث تلقائي',
  'Line detail': 'تفاصيل الأسطر',
  'Manual only': 'يدوي فقط',
  'Every {{n}} min': 'كل {{n}} دقيقة',
  'At set times…': 'في أوقات محددة…',
  'Load now': 'تحميل الآن',
  'Load an explicit period (e.g. backfill older history) for all enabled data types. This appends to existing data — nothing is deleted.':
    'تحميل فترة محددة (مثل استكمال تاريخ أقدم) لكل أنواع البيانات المفعّلة. يضاف إلى البيانات الموجودة — لا يُحذف شيء.',
  'Fresh reload of stores, subsidiaries, employees, departments, vendors, customers and items. No sales or inventory data is loaded.':
    'إعادة تحميل كاملة للمتاجر والشركات التابعة والموظفين والأقسام والموردين والعملاء والأصناف. لا يتم تحميل بيانات المبيعات أو المخزون.',
  'Currency': 'العملة',
  'Show sign on money values': 'إظهار رمز العملة مع القيم',
  'Number Format': 'تنسيق الأرقام', 'No decimals': 'بدون كسور', '2 decimals': 'كسران عشريان',
  'Abbreviate large numbers (1.2M / 340K)': 'اختصار الأرقام الكبيرة (1.2M / 340K)',
  'Language': 'اللغة', 'English': 'English',
  'Arabic flips the whole layout right-to-left': 'العربية تقلب الواجهة كاملة من اليمين لليسار',
  'Item Grid Columns': 'أعمدة جداول الأصناف',
  'Analytics Thresholds': 'حدود التحليلات',
  'Customer dormant after (days)': 'اعتبار العميل خاملًا بعد (يوم)',
  'DOH red above (days)': 'تغطية حمراء فوق (يوم)',
  'DOH amber above (days)': 'تغطية برتقالية فوق (يوم)',
  'Good margin at (%)': 'هامش جيد عند (%)',
  'Low margin below (%)': 'هامش منخفض تحت (%)',
  'Quiet hours (no background sync)': 'ساعات الهدوء (بدون مزامنة بالخلفية)',
  'Incremental Refresh': 'تحديث تزايدي',
  'Manual load — one-time pull from Oracle': 'تحميل يدوي — سحب لمرة واحدة من أوراكل',
  'Applies connection, data model and schedule changes': 'يطبّق تغييرات الاتصال ونموذج البيانات والجداول',
  'Refresh window': 'نافذة التحديث', 'Timezone': 'المنطقة الزمنية',
  'Last 7 days': 'آخر 7 أيام', 'Last 30 days': 'آخر 30 يومًا', 'Last 90 days': 'آخر 90 يومًا',
  'Purchases': 'المشتريات', 'Inventory': 'المخزون', 'Sales': 'المبيعات',
  'Sun': 'الأحد', 'Mon': 'الاثنين', 'Tue': 'الثلاثاء', 'Wed': 'الأربعاء',
  'Thu': 'الخميس', 'Fri': 'الجمعة', 'Sat': 'السبت',

  // ── Performance page ──
  'Store Rankings': 'ترتيب الفروع', 'Payment Mix': 'مزيج طرق الدفع',
  'Hourly Sales Heatmap': 'خريطة المبيعات بالساعة',
  'Top Associates': 'أفضل البائعين', 'Top Customers': 'أفضل العملاء',
  'Return Rate by Store': 'نسبة المرتجعات حسب الفرع',
  'Discount Rate by Store': 'نسبة الخصومات حسب الفرع',
  'Year-over-Year by Store': 'مقارنة سنوية حسب الفرع',
  'Net sales by branch · top 10': 'صافي المبيعات حسب الفرع · أعلى 10',
  'Cash · Card · Deposit · Other': 'نقدًا · بطاقة · عربون · أخرى',
  'Net sales intensity · hour of day × day of week': 'كثافة المبيعات · الساعة × اليوم',
  'Ranked by net sales · disc % amber >10% · return % red >5%': 'مرتب حسب صافي المبيعات',
  'Ranked by net spend for the selected period': 'مرتب حسب صافي الإنفاق في الفترة',
  'Total net sales per weekday': 'صافي المبيعات لكل يوم أسبوع',
  'Transaction count by value bucket': 'عدد الفواتير حسب فئة القيمة',
  'Return value ÷ gross sales · dashed = avg': 'قيمة المرتجعات ÷ إجمالي المبيعات · المتقطع = المتوسط',
  'Total discounts ÷ gross sales · dashed = avg': 'إجمالي الخصومات ÷ إجمالي المبيعات · المتقطع = المتوسط',

  // ── Forced password-change dialog ──
  'Set a new password': 'تعيين كلمة مرور جديدة',
  'This account is still using the default password. For security you must change it before using RetailTec Analytics.':
    'لا يزال هذا الحساب يستخدم كلمة المرور الافتراضية. للأمان يجب تغييرها قبل استخدام ريتيل تك.',
  'Current password': 'كلمة المرور الحالية',
  'New password (min 8 chars)': 'كلمة المرور الجديدة (8 أحرف على الأقل)',
  'Repeat new password': 'إعادة إدخال كلمة المرور الجديدة',
  'Change Password': 'تغيير كلمة المرور',
  'Log out': 'تسجيل الخروج',
  'New password must be at least 8 characters': 'يجب أن تكون كلمة المرور الجديدة 8 أحرف على الأقل',
  'Passwords do not match': 'كلمتا المرور غير متطابقتين',
  'Failed to change password': 'تعذّر تغيير كلمة المرور',

  // ── Login ──
  'Welcome back': 'مرحبًا بعودتك',
  'Sign in to your RetailTec workspace': 'سجّل الدخول إلى منصة ريتيل تك',
  'USERNAME': 'اسم المستخدم', 'PASSWORD': 'كلمة المرور',
  'Sign In →': 'تسجيل الدخول',
  'Quick search...': 'بحث سريع...',

  // ── Dimension pages ──
  'Store Intelligence': 'ذكاء الفروع',
  'Employee Performance Intelligence': 'ذكاء أداء الموظفين',

  // ── Ledger legend ──
  'Opening Balance': 'رصيد افتتاحي', 'Sales / COGS': 'مبيعات / تكلفة',
  'Transfers Out': 'تحويلات صادرة', 'Ending Balance': 'رصيد ختامي',

  // ── Settings page ──
  'Test Connection': 'اختبار الاتصال', 'Stop Load': 'إيقاف التحميل',
  'Load All Data now': 'تحميل كل البيانات الآن',
  'Backup Now': 'نسخ احتياطي الآن', 'Compact Database': 'ضغط قاعدة البيانات',
  'Save Email Settings': 'حفظ إعدادات البريد', 'Send Test Email': 'إرسال بريد تجريبي',
  'Add Report': 'إضافة تقرير', 'Save Report Schedules': 'حفظ جداول التقارير',
  'Send Now': 'إرسال الآن',
  'Background sync': 'مزامنة تلقائية بالخلفية', 'Enabled': 'مفعل',
  'Name': 'الاسم', 'Report type': 'نوع التقرير', 'Send at': 'وقت الإرسال',
  'Product Code Field': 'حقل رمز الصنف',
  'Incremental overlap': 'نافذة التحديث',
  'Load window': 'نافذة التحميل', 'Detail retention': 'الاحتفاظ بالتفاصيل',
  'Times': 'الأوقات',

  // ── Users page ──
  'Manage who can access RetailTec Analytics and what they can see.':
    'إدارة من يمكنه الوصول إلى ريتيل تك وما يمكنه رؤيته.',

  // ── Dynamic KPI subs (templates) ──
  'across {{n}} stores': 'في {{n}} فرعًا',
  '{{n}} departments': '{{n}} أقسام',
  '{{n}} returned': '{{n}} مرتجع',
  '{{n}} lines': '{{n}} بندًا',

  // ── Transactions page ──
  'hidden': 'مخفي',
  'Loading...': 'جارٍ التحميل...',
  'Show / Hide Columns': 'إظهار / إخفاء الأعمدة',
  'Show all': 'إظهار الكل',
  '{{n}} transactions  ·  {{from}}  →  {{to}}': '{{n}} فاتورة  ·  {{from}}  →  {{to}}',

  // ── Performance YoY ──
  'Current period vs same window last year  ·  {{from}} → {{to}}':
    'الفترة الحالية مقابل نفس الفترة العام الماضي  ·  {{from}} → {{to}}',

  // ── Adjustments page ──
  'Daily Adjustment Trend (Cost $)': 'اتجاه التسويات اليومية (التكلفة $)',
  'Download PNG': 'تنزيل PNG',
  '+ Positive Cost': 'التكلفة الموجبة +',
  '− Negative Cost': 'التكلفة السالبة −',

  // ── Ledger page ──
  'Item × Store combinations': 'تركيبات صنف × فرع',
  'qty {{n}}': 'كمية {{n}}',
  'units sold {{n}}': '{{n}} وحدة مباعة',
  'Search {{code}} / Desc': 'بحث {{code}} / الوصف',
  'End Qty': 'كمية ختامية',
  'End Cost': 'تكلفة ختامية',

  // ── Coverage page ──
  'Coverage & Replenishment Planning': 'تخطيط التغطية وإعادة التوريد',
  'AVG basis:': 'أساس المتوسط:',
  'Search item ({{code}} / description)': 'بحث عن صنف ({{code}} / الوصف)',
  'Onhand Qty': 'الكمية المتوفرة',
  'Sales ({{n}}d Qty)': 'المبيعات (كمية {{n}} يوم)',
  'Daily AVG: {{v}} units': 'المتوسط اليومي: {{v}} وحدة',
  'Critical (< 7d)': 'حرج (< 7 أيام)',
  'reorder immediately': 'أعد الطلب فورًا',
  'Stagnant SKUs': 'أصناف راكدة',
  'no sales in {{n}}d window': 'لا مبيعات خلال {{n}} يوم',
  '{{label}} — {{n}} SKU×Store': '{{label}} — {{n}} صنف×فرع',
  'Daily AVG calculated from last {{n}} days · Days Coverage = Onhand ÷ Daily AVG':
    'المتوسط اليومي محسوب من آخر {{n}} يوم · أيام التغطية = المتوفر ÷ المتوسط اليومي',
  'Daily AVG': 'المتوسط اليومي',
  'Days Coverage': 'أيام التغطية',
  'Item Description': 'وصف الصنف',
  'Last Sold': 'آخر بيع',
  'Sales 30d': 'مبيعات 30 يوم',
  'Sales 60d': 'مبيعات 60 يوم',
  'Sales 90d': 'مبيعات 90 يوم',
  'Stagnant': 'راكد',
  'All Items': 'كل الأصناف',
  'Under 7 Days': 'أقل من 7 أيام',
  '7 – 30 Days': '7 – 30 يوم',
  '30 – 60 Days': '30 – 60 يوم',
  'Over 60 Days': 'أكثر من 60 يوم',
  'Show all items with stock': 'عرض كل الأصناف المتوفرة',
  'Critical — reorder immediately': 'حرج — أعد الطلب فورًا',
  'Watch — plan replenishment soon': 'راقب — خطّط لإعادة التوريد قريبًا',
  'Adequate — monitor': 'كافٍ — راقب',
  'Overstocked — review order frequency': 'فائض — راجع وتيرة الطلب',
  'No sales in selected period': 'لا مبيعات في الفترة المحددة',

  // ── Items page ──
  'revenue {{p}}%': 'إيراد {{p}}%',
  'of total': 'من الإجمالي',
  'Price Lvl': 'مستوى السعر',
  'Text 2': 'نص 2',
  // item-master optional column labels
  'Description 2': 'الوصف 2', 'Description 3': 'الوصف 3', 'Description 4': 'الوصف 4',
  'Long Description': 'وصف مطوّل', 'Attribute': 'السمة', 'Size': 'المقاس',
  'Text 1': 'نص 1', 'Text 3': 'نص 3', 'Text 4': 'نص 4', 'Text 5': 'نص 5',
  'Text 6': 'نص 6', 'Text 7': 'نص 7', 'Text 8': 'نص 8', 'Text 9': 'نص 9', 'Text 10': 'نص 10',
  'UDF 1': 'حقل مخصص 1', 'UDF 2': 'حقل مخصص 2', 'UDF 3': 'حقل مخصص 3',
  'UDF 4': 'حقل مخصص 4', 'UDF 5': 'حقل مخصص 5',
  'Price Level 1': 'مستوى السعر 1', 'Price Level 2': 'مستوى السعر 2', 'Price Level 3': 'مستوى السعر 3',
  'GP ≥ 40% — protect price integrity': 'ربح ≥ 40% — حافظ على سلامة السعر',
  'GP 20–40% — healthy contribution': 'ربح 20–40% — مساهمة صحية',
  'GP 0–20% — review pricing or cost': 'ربح 0–20% — راجع السعر أو التكلفة',
  'Negative GP — immediate attention needed': 'ربح سالب — يتطلب انتباهًا فوريًا',

  // ── Users Management page ──
  'Store Access': 'صلاحية الفروع',
  'Select which stores this user can access. Leave all unchecked to grant access to all stores.':
    'اختر الفروع التي يمكن لهذا المستخدم الوصول إليها. اترك الكل بدون تحديد لمنح صلاحية كل الفروع.',
  'Select All': 'تحديد الكل', 'Clear': 'مسح',
  'No stores found': 'لا توجد فروع',
  '{{n}} stores selected': 'تم تحديد {{n}} فرع',
  'Access to all stores (no restriction)': 'صلاحية كل الفروع (بدون قيود)',
  'Cancel': 'إلغاء',
  'Failed to load users': 'تعذر تحميل المستخدمين',
  'All pages': 'كل الصفحات',
  'Subsidiary': 'الشركة التابعة',
  'Subsidiaries': 'الشركات التابعة',
  'All Subsidiaries': 'كل الشركات التابعة',
  'All subsidiaries (no restriction)': 'كل الشركات التابعة (بدون قيود)',
  '{{n}} of {{b}} subsidiaries': '{{n}} من {{b}} شركة تابعة',
  '{{a}} of {{b}}': '{{a}} من {{b}}',
  'Edit': 'تعديل', 'Delete': 'حذف',
  'Delete user "{{u}}"?': 'حذف المستخدم "{{u}}"؟',
  'No users yet': 'لا يوجد مستخدمون بعد',
  'Full access including settings & user management': 'صلاحية كاملة تشمل الإعدادات وإدارة المستخدمين',
  'All analytics pages, no settings': 'كل صفحات التحليلات بدون الإعدادات',
  'Read-only, store-scoped if stores are set': 'قراءة فقط، محصورة بالفروع إن حُددت',
  'Edit User': 'تعديل مستخدم', 'Add New User': 'إضافة مستخدم جديد',
  'Full Name': 'الاسم الكامل', 'Username *': 'اسم المستخدم *',
  'New Password (leave blank to keep)': 'كلمة مرور جديدة (اتركها فارغة للإبقاء)',
  'Password *': 'كلمة المرور *',
  'Admin': 'مدير', 'Manager': 'مشرف', 'Viewer': 'مطّلع',
  'admin': 'مدير', 'manager': 'مشرف', 'viewer': 'مطّلع',
  'Full Access': 'صلاحية كاملة', 'Analytics Access': 'صلاحية التحليلات', 'Read-Only Access': 'صلاحية القراءة فقط',
  'View details': 'عرض التفاصيل', '+{{n}} more…': '+{{n}} أخرى…',
  'Edit Stores': 'تعديل الفروع', 'Select Stores': 'اختيار الفروع',
  'All stores (no restriction)': 'كل الفروع (بدون قيود)',
  'Page Access': 'صلاحية الصفحات',
  'All pages (no restriction)': 'كل الصفحات (بدون قيود)',
  '{{n}} of {{b}} pages': '{{n}} من {{b}} صفحة',
  'Account Active': 'الحساب مفعّل',
  'Save Changes': 'حفظ التغييرات', 'Create User': 'إنشاء مستخدم',
  'Role Privileges': 'صلاحيات الدور', 'Current selection': 'الاختيار الحالي', 'Close': 'إغلاق',
  'Error creating user': 'خطأ في إنشاء المستخدم',
  'Error updating user': 'خطأ في تحديث المستخدم',
  'Cannot delete user': 'تعذر حذف المستخدم',
  'Username is required': 'اسم المستخدم مطلوب',
  'Password is required for new users': 'كلمة المرور مطلوبة للمستخدمين الجدد',
  // page-permission domains & labels
  'Purchasing': 'المشتريات', 'Dimensions': 'البيانات الأساسية',
  'Overview': 'نظرة عامة', 'Movement': 'حركة المخزون', 'Ledger': 'دفتر المخزون',
  'Coverage': 'تغطية المخزون', 'Customers': 'العملاء', 'Employees': 'الموظفون', 'Items': 'الأصناف',
  'All Sales analytics (Overview, Performance, Products, Transactions)':
    'كل تحليلات المبيعات (نظرة عامة، الأداء، المنتجات، الفواتير)',
  'All Inventory analytics (Overview, Movement, History, Coverage, Ledger, Adjustments)':
    'كل تحليلات المخزون (نظرة عامة، الحركة، السجل، التغطية، الدفتر، التسويات)',
  'All Purchases analytics (Overview, Transactions)':
    'كل تحليلات المشتريات (نظرة عامة، الحركات)',
  'All Dimension intelligence (Customers, Employees, Vendors, Items)':
    'كل ذكاء البيانات الأساسية (العملاء، الموظفون، الموردون، الأصناف)',
  'Settings — app-wide configuration': 'الإعدادات — إعداد على مستوى التطبيق',
  'Users Management — create, edit, delete users': 'إدارة المستخدمين — إنشاء وتعديل وحذف المستخدمين',
  'All Sales analytics': 'كل تحليلات المبيعات',
  'All Inventory analytics': 'كل تحليلات المخزون',
  'All Purchases analytics': 'كل تحليلات المشتريات',
  'All Dimension intelligence': 'كل ذكاء البيانات الأساسية',
  'Store scope: limited to assigned stores if set': 'نطاق الفروع: محصور بالفروع المعيّنة إن حُددت',
  'No access to Settings or Users Management': 'لا صلاحية للإعدادات أو إدارة المستخدمين',
  'Sales Overview & Performance (read-only)': 'نظرة عامة على المبيعات والأداء (قراءة فقط)',
  'Inventory Overview (read-only)': 'نظرة عامة على المخزون (قراءة فقط)',
  'Store scope: strictly limited to assigned stores': 'نطاق الفروع: محصور تمامًا بالفروع المعيّنة',
  'No access to Purchases, Dimensions, Settings, or Users Management':
    'لا صلاحية للمشتريات أو البيانات الأساسية أو الإعدادات أو إدارة المستخدمين',

  // ── Data Model Settings page ──
  'Host IP / Hostname': 'عنوان الخادم / اسم المضيف',
  'Port': 'المنفذ', 'Service Name': 'اسم الخدمة', 'e.g. rproods': 'مثال rproods',
  'Enter to change password': 'أدخل لتغيير كلمة المرور',
  'Connection failed': 'فشل الاتصال',
  'Choose which product code appears alongside the item description in charts and tables throughout the dashboard.':
    'اختر رمز المنتج الذي يظهر بجانب وصف الصنف في الرسوم والجداول عبر لوحة المعلومات.',
  'Showing ALU (internal item code) · e.g. ALU001 | Blue Shirt':
    'يعرض ALU (رمز الصنف الداخلي) · مثال ALU001 | قميص أزرق',
  'Showing UPC (barcode) · e.g. 123456789 | Blue Shirt':
    'يعرض UPC (الباركود) · مثال 123456789 | قميص أزرق',
  'e.g. 17.2M (no sign)': 'مثال 17.2M (بدون رمز)',
  'Extra item-master fields shown as columns in every table that lists items (descriptions, texts, UDFs, price levels). Applied instantly — data appears after the next sync refreshes the item master.':
    'حقول إضافية من ملف الأصناف تُعرض كأعمدة في كل جدول يسرد الأصناف (الأوصاف، النصوص، الحقول المخصصة، مستويات الأسعار). تُطبّق فورًا — تظهر البيانات بعد أن تحدّث المزامنة التالية ملف الأصناف.',
  'None — default columns only': 'لا شيء — الأعمدة الافتراضية فقط',
  'Drive the traffic-light colours across the dashboard (days-on-hand, margin quality, dormant customers). Saved instantly.':
    'تحدد ألوان الإشارة عبر لوحة المعلومات (أيام التغطية، جودة الهامش، العملاء الخاملون). تُحفظ فورًا.',
  'DOH amber above': 'تغطية برتقالية فوق', 'DOH red above': 'تغطية حمراء فوق',
  'Customer dormant after': 'اعتبار العميل خاملًا بعد',
  'Low margin below': 'هامش منخفض تحت', 'Good margin at': 'هامش جيد عند',
  'days': 'يوم',
  'Last {{n}} days': 'آخر {{n}} يوم',
  'Sync': 'مزامنة',
  'Full load': 'تحميل كامل',
  'Scheduled sync': 'مزامنة مجدولة', 'Incremental refresh': 'تحديث تزايدي',
  'estimating…': 'جارٍ التقدير…',
  'Last sync: {{t}}': 'آخر مزامنة: {{t}}',
  'Runs once, right now. How far back each domain goes is its Load window in Refresh Schedules & Retention below. Tick domains to load only those — all unchecked = everything.':
    'يعمل مرة واحدة الآن. مدى الرجوع لكل نطاق يحدده حقل نافذة التحميل في جداول التحديث والاحتفاظ أدناه. حدّد نطاقات لتحميلها فقط — الكل بدون تحديد = كل شيء.',
  'Load {{d}} now': 'تحميل {{d}} الآن',
  'Controls the automatic refresh of each domain: at specific times on selected days, on a fixed interval, or manual only. The Load window here sets how far back that domain keeps data — it is also the period the manual Load now button above pulls. Retention prunes old line-item detail while keeping daily summaries forever. Times use the timezone selected above. Remember to Save Settings.':
    'يتحكم في التحديث التلقائي لكل نطاق: في أوقات محددة بأيام مختارة، أو بفاصل ثابت، أو يدويًا فقط. حقل نافذة التحميل هنا يحدد مدى احتفاظ النطاق بالبيانات — وهو أيضًا الفترة التي يسحبها زر التحميل اليدوي أعلاه. الاحتفاظ يقلّم تفاصيل البنود القديمة مع الإبقاء على الملخصات اليومية دائمًا. تستخدم الأوقات المنطقة الزمنية المختارة أعلاه. تذكّر حفظ الإعدادات.',
  'Manual': 'يدوي', 'Interval': 'فاصل زمني',
  'Every': 'كل', '{{n}} min': '{{n}} دقيقة',
  'Times — 06:00, 12:00, 18:00': 'الأوقات — 06:00، 12:00، 18:00',
  'HH:MM, comma-separated': 'ساعة:دقيقة، مفصولة بفواصل',
  'No automatic refresh — use Sync buttons or a range load.': 'لا تحديث تلقائي — استخدم أزرار المزامنة أو تحميل نطاق.',
  '6 months': '6 أشهر', '12 months': '12 شهرًا', '24 months': '24 شهرًا',
  '36 months': '36 شهرًا', 'Keep everything': 'الاحتفاظ بكل شيء',
  'Load an explicit period (e.g. backfill older history). This appends to existing data — nothing is deleted. Respects the domain selection above.':
    'حمّل فترة محددة (مثل استكمال سجل أقدم). يُضاف هذا إلى البيانات الموجودة — لا يُحذف شيء. يراعي اختيار النطاقات أعلاه.',
  'Load Range': 'تحميل النطاق',
  'The date span actually present in the warehouse, per domain.': 'المدى الزمني الموجود فعليًا في المستودع لكل نطاق.',
  'Domain': 'النطاق', 'Rows': 'الصفوف', 'snapshot': 'لقطة',
  'Last run: {{type}} · {{status}}': 'آخر تشغيل: {{type}} · {{status}}',
  'No sync runs yet.': 'لا عمليات مزامنة بعد.',
  'Saving…': 'جارٍ الحفظ…',
  'Host changed — switched to new database. Run Load All Data to populate it.':
    'تغيّر المضيف — تم التبديل إلى قاعدة بيانات جديدة. شغّل تحميل كل البيانات لتعبئتها.',
  'Settings saved': 'تم حفظ الإعدادات', 'Save failed': 'فشل الحفظ',
  'Back up the local warehouse file (safe while the app is running), or compact it to flush pending writes and reclaim space.':
    'انسخ ملف المستودع المحلي احتياطيًا (آمن أثناء تشغيل التطبيق)، أو اضغطه لإفراغ الكتابات المعلقة واستعادة المساحة.',
  'Backup folder (empty = backend/backups)': 'مجلد النسخ الاحتياطي (فارغ = backend/backups)',
  'Backing up…': 'جارٍ النسخ الاحتياطي…', 'Compacting…': 'جارٍ الضغط…',
  'Backup saved: {{path}} ({{mb}} MB)': 'تم حفظ النسخة: {{path}} ({{mb}} ميجابايت)',
  'Compacted: {{a}} MB → {{b}} MB': 'تم الضغط: {{a}} ميجابايت → {{b}} ميجابايت',
  'Backup failed': 'فشل النسخ الاحتياطي', 'Compact failed': 'فشل الضغط',
  'Restore from backup': 'الاستعادة من نسخة احتياطية',
  'No backups yet': 'لا توجد نسخ احتياطية بعد',
  'Restore': 'استعادة', 'Restoring…': 'جارٍ الاستعادة…',
  'Restore failed': 'فشلت الاستعادة',
  'Restored {{file}} — {{n}} invoices in the warehouse': 'تمت استعادة {{file}} — {{n}} فاتورة في المستودع',
  'Replace the current database with this backup? Data loaded after the backup was taken will be lost. The current file is kept as a pre restore copy.':
    'هل تريد استبدال قاعدة البيانات الحالية بهذه النسخة الاحتياطية؟ ستُفقد البيانات المحمّلة بعد إنشاء النسخة. يُحتفظ بالملف الحالي كنسخة ما قبل الاستعادة.',
  'Restores the currently connected database from one of its backups. A safety copy of the current file is kept.':
    'يستعيد قاعدة البيانات المتصلة حاليًا من إحدى نسخها الاحتياطية. يُحتفظ بنسخة أمان من الملف الحالي.',
  'Or full path to a backup file': 'أو المسار الكامل لملف نسخة احتياطية',
  'Browse…': 'استعراض…',
  'Used for sending reports and alerts. Works with your company mail server or Gmail (smtp.gmail.com, port 587, app password). The password is stored encrypted.':
    'يُستخدم لإرسال التقارير والتنبيهات. يعمل مع خادم بريد شركتك أو Gmail (smtp.gmail.com، المنفذ 587، كلمة مرور تطبيق). تُخزَّن كلمة المرور مشفّرة.',
  'SMTP host': 'خادم SMTP', 'Username': 'اسم المستخدم', 'Password': 'كلمة المرور',
  'Password (saved — enter to change)': 'كلمة المرور (محفوظة — أدخل للتغيير)',
  'From address': 'عنوان المرسل', 'Use TLS': 'استخدام TLS',
  'Send test to': 'إرسال اختبار إلى', 'Sending…': 'جارٍ الإرسال…',
  'Email settings saved': 'تم حفظ إعدادات البريد', 'Test failed': 'فشل الاختبار',
  'Each report has its own type, send time, store scope and recipients — e.g. a morning sales report for all stores to the owner, plus a separate one per branch manager scoped to their store. Uses the SMTP settings above. Remember to Save Report Schedules.':
    'لكل تقرير نوعه ووقت إرساله ونطاق فروعه ومستلموه — مثل تقرير مبيعات صباحي لكل الفروع للمالك، إضافة إلى تقرير منفصل لكل مدير فرع محصور بفرعه. يستخدم إعدادات SMTP أعلاه. تذكّر حفظ جداول التقارير.',
  'last sent {{t}}': 'أُرسل آخر مرة {{t}}',
  'Delete report': 'حذف التقرير',
  'Stores (empty = all stores)': 'الفروع (فارغ = كل الفروع)',
  'Recipients (comma-separated)': 'المستلمون (مفصولون بفواصل)',
  'Report schedules saved': 'تم حفظ جداول التقارير', 'Send failed': 'فشل الإرسال',
  'By': 'بواسطة', 'Started': 'بدأ', 'Duration': 'المدة',
  'All types': 'كل الأنواع', 'All statuses': 'كل الحالات',
  'range': 'نطاق', 'full': 'كامل', 'incremental': 'تزايدي', 'scheduled': 'مجدول',
  'completed': 'مكتمل', 'running': 'قيد التشغيل', 'error': 'خطأ', 'aborted': 'متوقف', 'cancelled': 'ملغى',
  'Refreshing…': 'جارٍ التحديث…', 'Refresh': 'تحديث',
  'No runs match the selected filters.': 'لا عمليات تطابق عوامل التصفية المحددة.',

  // ── Audit Log page ──
  'Audit Log': 'سجل التدقيق',
  'Logins, user changes, settings and data actions': 'عمليات تسجيل الدخول وتغييرات المستخدمين وإجراءات الإعدادات والبيانات',
  'Failed to load audit log': 'تعذّر تحميل سجل التدقيق',
  'Time': 'الوقت', 'Action': 'الإجراء', 'Detail': 'التفاصيل', 'Rows': 'عدد الصفوف',
  'Last {{n}}': 'آخر {{n}}', '{{n}} events': '{{n}} حدثًا',
  // Action labels
  'Login': 'تسجيل الدخول', 'Login failed': 'فشل تسجيل الدخول',
  'Change password': 'تغيير كلمة المرور',
  'User created': 'إنشاء مستخدم', 'User updated': 'تعديل مستخدم', 'User deleted': 'حذف مستخدم',
  'Backup': 'نسخ احتياطي', 'Compact database': 'ضغط قاعدة البيانات',
  'Email settings saved': 'حفظ إعدادات البريد', 'Range load': 'تحميل فترة',
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

/** Translate a template with values, e.g. trf('across {{n}} stores', { n: 23 }).
 *  Falls back to simple substitution in English / when untranslated. */
export function trf(s: string, params: Record<string, string | number>): string {
  if (i18n.language === 'ar') {
    const out = i18n.t(s, { ...params, defaultValue: s }) as string
    if (out !== s) return out
  }
  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), s)
}

/** Translate AG Grid column headers (headerName) in a colDefs array. */
export function trCols<T extends { headerName?: string }>(cols: T[]): T[] {
  if (i18n.language !== 'ar') return cols
  return cols.map(c => c.headerName ? { ...c, headerName: tr(c.headerName) } : c)
}

export default i18n
