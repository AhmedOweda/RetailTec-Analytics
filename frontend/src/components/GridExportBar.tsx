/**
 * GridExportBar — reusable AG Grid toolbar
 * ✦ Column show/hide picker  ✦ Excel (XLSX)  ✦ PDF  ✦ Email report (PDF/Excel)
 *
 * Usage:
 *   const gridRef = useRef<AgGridReact>(null)
 *   <GridExportBar gridRef={gridRef} filename="stores" title="Store Intelligence"
 *     colDefs={colDefs} onResetColumns={resetColumns} />
 */
import { useState, useEffect } from 'react'
import {
  Box, Button, Stack, Popover, FormControlLabel,
  Checkbox, Divider, CircularProgress, Typography,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  ToggleButton, ToggleButtonGroup, MenuItem, Select, IconButton,
  Snackbar, Alert, Tooltip,
} from '@mui/material'
import FileDownloadIcon  from '@mui/icons-material/FileDownload'
import PictureAsPdfIcon  from '@mui/icons-material/PictureAsPdf'
import ViewColumnIcon    from '@mui/icons-material/ViewColumn'
import EmailIcon         from '@mui/icons-material/Email'
import HistoryIcon       from '@mui/icons-material/History'
import CloseIcon         from '@mui/icons-material/Close'
import type { AgGridReact } from 'ag-grid-react'
import type { ColDef }      from 'ag-grid-community'
import * as XLSX from 'xlsx'
import jsPDF     from 'jspdf'
import autoTable from 'jspdf-autotable'
import axios     from 'axios'
import { tr }    from '../i18n'
import { useAuth } from '../contexts/AuthContext'
import { isArabic, hasArabic, registerArabicFont, shapeAr, ARABIC_FONT_NAME } from '../utils/pdfArabic'
import { arabicTableToPdf } from '../utils/pdfImage'

const ACCENT = '#7c3aed'

interface Props {
  gridRef:          React.RefObject<AgGridReact>
  filename:         string
  title?:           string
  subtitle?:        string
  /** Active grid/tab within the page, e.g. "By Item Vendor" — makes the
   *  subject/schedule name definite when a page has several grids. */
  view?:            string
  /** Active slicer summary, e.g. "16 Jun → 15 Jul 2026 · All stores".
   *  Shown in the email body so the recipient knows the exact filters. */
  filters?:         string
  colDefs?:         ColDef[]
  onResetColumns?:  () => void
}

interface RecipientList { name: string; recipients: string }

export default function GridExportBar({
  gridRef, filename, title, subtitle, view, filters, colDefs, onResetColumns,
}: Props) {

  /* A definite label that names the page AND the active grid/tab. */
  const definiteLabel = [title ?? filename, view].filter(Boolean).join(' — ')

  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [colAnchor,  setColAnchor ] = useState<HTMLElement | null>(null)
  const [exporting,  setExporting ] = useState<'excel' | 'pdf' | null>(null)

  /* ── Email dialog state ───────────────────────────────────────── */
  const [emailOpen, setEmailOpen] = useState(false)
  const [fmt,       setFmt      ] = useState<'pdf' | 'excel'>('pdf')
  const [subject,   setSubject  ] = useState('')
  const [recipients,setRecipients] = useState('')
  const [note,      setNote     ] = useState('')
  const [sending,   setSending  ] = useState(false)
  const [lists,     setLists    ] = useState<RecipientList[]>([])
  const [toast,     setToast    ] = useState<{ msg: string; sev: 'success' | 'error' } | null>(null)

  /* ── Schedule state (admin only) ──────────────────────────────── */
  const { isAdmin } = useAuth()
  const [mode,        setMode      ] = useState<'now' | 'schedule'>('now')
  const [schedType,   setSchedType ] = useState('daily_sales')
  const [schedTime,   setSchedTime ] = useState('07:00')
  const [schedFreq,   setSchedFreq ] = useState<'daily' | 'weekly' | 'monthly' | 'once'>('daily')
  const [schedWeekday,setSchedWeekday] = useState(0)
  const [schedDay,    setSchedDay  ] = useState(1)
  const [schedDate,   setSchedDate ] = useState('')
  const [reportTypes, setReportTypes] = useState<Record<string, string>>({})
  const [creating,    setCreating  ] = useState(false)
  const WEEKDAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

  useEffect(() => {
    if (!emailOpen) return
    setSubject(s => s || `${definiteLabel} — ${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`)
    axios.get('/api/reports/recipient-lists')
      .then(r => setLists(r.data?.lists ?? []))
      .catch(() => setLists([]))
    if (isAdmin) {
      axios.get('/api/admin/reports')
        .then(r => setReportTypes(r.data?.types ?? {}))
        .catch(() => setReportTypes({}))
    }
  }, [emailOpen])   // eslint-disable-line react-hooks/exhaustive-deps

  const createSchedule = async () => {
    if (!recipients.trim()) { setToast({ msg: tr('Add at least one recipient'), sev: 'error' }); return }
    setCreating(true)
    try {
      const cur = await axios.get('/api/admin/reports')
      const reports = cur.data?.reports ?? []
      reports.push({
        type: schedType, name: definiteLabel,   // definite (page + grid), no date
        time: schedTime, freq: schedFreq,
        weekday: schedWeekday, day: schedDay, date: schedDate || null,
        stores: '', recipients, enabled: true,
      })
      await axios.put('/api/admin/reports', { reports })
      setToast({ msg: tr('Schedule created — manage it in Settings → Reports'), sev: 'success' })
      setEmailOpen(false); setMode('now')
    } catch (e: any) {
      setToast({ msg: e?.response?.data?.detail ?? tr('Could not create schedule (admin only)'), sev: 'error' })
    } finally { setCreating(false) }
  }

  /* ── Column picker ────────────────────────────────────────────── */
  const toggleCol = (field: string, visible: boolean) => {
    gridRef.current?.api?.setColumnVisible(field, visible)
    setHiddenCols(prev => {
      const next = new Set(prev)
      visible ? next.delete(field) : next.add(field)
      return next
    })
  }
  const showAll = () => {
    colDefs?.forEach(c => {
      const id = c.field ?? (c as any).colId ?? ''
      if (id) gridRef.current?.api?.setColumnVisible(id, true)
    })
    setHiddenCols(new Set())
  }
  const handleReset = () => { onResetColumns?.(); setHiddenCols(new Set()); setColAnchor(null) }

  /* ── Helpers ──────────────────────────────────────────────────── */
  const colLabel = (c: ColDef): string =>
    (typeof c.headerName === 'string' ? c.headerName : null) ?? c.field ?? (c as any).colId ?? 'Column'

  const getVisibleColInfo = () => {
    const api = gridRef.current?.api
    if (!api) return []
    const out: { id: string; label: string; type: string }[] = []
    api.getAllDisplayedColumns().forEach(col => {
      const def = col.getColDef()
      out.push({
        id:    col.getColId(),
        label: (typeof def.headerName === 'string' ? def.headerName : null) ?? col.getColId(),
        type:  (def.type as string) ?? '',
      })
    })
    return out
  }
  const getRowsAfterFilter = (): any[] => {
    const api = gridRef.current?.api
    if (!api) return []
    const out: any[] = []
    api.forEachNodeAfterFilterAndSort((n: any) => { if (n.data) out.push(n.data) })
    return out
  }

  /* ── Build (not download) an Excel workbook from the visible/filtered grid ── */
  const makeWorkbook = (): XLSX.WorkBook => {
    const cols = getVisibleColInfo()
    const rows = getRowsAfterFilter()
    const api  = gridRef.current?.api
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r: any) => Object.fromEntries(cols.map(c => {
        const vf  = api ? (api.getColumnDef(c.id) as any)?.valueFormatter : null
        const raw = r[c.id]
        const val = vf ? (vf({ value: raw, data: r, colDef: {} }) ?? raw ?? '') : (raw ?? '')
        return [c.label, val]
      })))
    )
    ws['!cols'] = cols.map(() => ({ wch: 14 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Data')
    return wb
  }

  /* ── Build (not save) a jsPDF doc from the visible/filtered grid ── */
  const makePdfDoc = async (): Promise<jsPDF> => {
    const cols = getVisibleColInfo()
    const api  = gridRef.current?.api
    const bodyRows: string[][] = []
    api?.forEachNodeAfterFilter((node: any) => {
      if (!node.data) return
      bodyRows.push(cols.map(c => {
        const vf  = (api.getColumnDef(c.id) as any)?.valueFormatter
        const raw = node.data[c.id]
        return vf ? (vf({ value: raw, data: node.data, colDef: {} }) ?? '') : (raw ?? '')
      }))
    })

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
    const ar  = isArabic()
    const headLabels = cols.map(c => tr(c.label))
    const bodyFlat   = bodyRows.flat()
    const needImage  = ar || hasArabic([...headLabels, ...bodyFlat])
    const subtitleTxt = subtitle ?? `Generated ${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`

    if (needImage) {
      await arabicTableToPdf(doc, {
        title: title ?? filename, subtitle: subtitleTxt,
        head: headLabels, body: bodyRows,
        filename: `${filename}.pdf`, rtl: ar,
      }, false)   // build only, don't save
      return doc
    }

    if (ar) registerArabicFont(doc)
    const W = 420
    doc.setFillColor(22, 11, 51); doc.rect(0, 0, W, 24, 'F')
    doc.setTextColor(255, 255, 255); doc.setFontSize(13)
    if (ar) doc.setFont(ARABIC_FONT_NAME, 'normal'); else doc.setFont('helvetica', 'bold')
    doc.text(shapeAr(title ?? filename), 14, 10)
    doc.setFontSize(8); doc.setTextColor(180, 160, 255)
    if (ar) doc.setFont(ARABIC_FONT_NAME, 'normal'); else doc.setFont('helvetica', 'normal')
    doc.text(shapeAr(subtitleTxt), 14, 17)
    doc.setTextColor(124, 58, 237); doc.setFontSize(10); doc.setFont('helvetica', 'bold')
    doc.text('RetailTec · Prism Analytics', W - 14, 10, { align: 'right' })
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(160, 140, 200)
    doc.text('Confidential — Internal Use Only', W - 14, 17, { align: 'right' })

    autoTable(doc, {
      startY: 28, head: [cols.map(c => c.label)], body: bodyRows, theme: 'grid',
      styles: { fontSize: 6.5, cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
        lineColor: [226, 232, 240], lineWidth: 0.3, textColor: [15, 23, 42],
        font: ar ? ARABIC_FONT_NAME : 'helvetica', ...(ar ? { halign: 'right' as const } : {}) },
      headStyles: { fillColor: [124, 58, 237], textColor: [255, 255, 255],
        fontStyle: 'bold', fontSize: 7.5, halign: ar ? 'right' : 'center',
        ...(ar ? { font: ARABIC_FONT_NAME } : {}) },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: cols.reduce((acc: any, c, i) => {
        if (c.type === 'numericColumn') acc[i] = { halign: 'right' }
        return acc
      }, {}),
      ...(ar ? {
        didParseCell: (data: any) => {
          if (Array.isArray(data.cell.text)) data.cell.text = data.cell.text.map((l: string) => shapeAr(l))
        },
      } : {}),
      didDrawPage: (data: any) => {
        const pH = doc.internal.pageSize.getHeight()
        doc.setFillColor(248, 250, 252); doc.rect(0, pH - 10, W, 10, 'F')
        doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
        doc.text(`Page ${data.pageNumber}`, 14, pH - 3)
        doc.text(`Total rows: ${bodyRows.length}`, W - 14, pH - 3, { align: 'right' })
      },
    })
    return doc
  }

  /* ── Download handlers ────────────────────────────────────────── */
  const stamp = new Date().toISOString().slice(0, 10)
  const exportExcel = async () => {
    setExporting('excel')
    try { XLSX.writeFile(makeWorkbook(), `${filename}_${stamp}.xlsx`) }
    finally { setExporting(null) }
  }
  const exportPdf = async () => {
    setExporting('pdf')
    try { (await makePdfDoc()).save(`${filename}_${stamp}.pdf`) }
    finally { setExporting(null) }
  }

  /* ── Report definitions shown in the email body ───────────────── */
  const buildDetails = (): Record<string, string> => {
    const cols = getVisibleColInfo()
    const rows = getRowsAfterFilter()
    const d: Record<string, string> = {}
    d[tr('Report')] = title ?? filename
    if (view)                 d[tr('View')]    = view
    if (filters)              d[tr('Filters')] = filters
    else if (subtitle)        d[tr('Period')]  = subtitle
    d[tr('Rows')]    = String(rows.length)
    d[tr('Columns')] = cols.map(c => tr(c.label)).join(', ')
    return d
  }

  /* ── Email handler ────────────────────────────────────────────── */
  const sendEmail = async () => {
    if (!recipients.trim()) { setToast({ msg: tr('Add at least one recipient'), sev: 'error' }); return }
    setSending(true)
    try {
      let content_base64 = ''
      let outName = ''
      let mime = ''
      const details = buildDetails()
      if (fmt === 'excel') {
        content_base64 = XLSX.write(makeWorkbook(), { type: 'base64', bookType: 'xlsx' })
        outName = `${filename}_${stamp}.xlsx`
        mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      } else {
        const doc = await makePdfDoc()
        content_base64 = (doc.output('datauristring') as string).split('base64,')[1]
        outName = `${filename}_${stamp}.pdf`
        mime = 'application/pdf'
      }
      await axios.post('/api/reports/email-grid', {
        subject: subject || definiteLabel,
        recipients, filename: outName, content_base64, mime,
        note: note || undefined, page: definiteLabel, details,
      })
      setToast({ msg: tr('Report emailed successfully'), sev: 'success' })
      setEmailOpen(false); setNote('')
    } catch (e: any) {
      setToast({ msg: e?.response?.data?.detail ?? tr('Failed to send report'), sev: 'error' })
    } finally { setSending(false) }
  }

  const saveCurrentAsList = async () => {
    const name = window.prompt(tr('Name this recipient list'))
    if (!name || !recipients.trim()) return
    const next = [...lists.filter(l => l.name !== name), { name, recipients: recipients.trim() }]
    try { await axios.put('/api/reports/recipient-lists', { lists: next }); setLists(next)
      setToast({ msg: tr('Recipient list saved'), sev: 'success' }) }
    catch { setToast({ msg: tr('Could not save list'), sev: 'error' }) }
  }

  const btnSx = (color: string) => ({
    textTransform: 'none', borderRadius: 2, fontWeight: 600, height: 32,
    borderColor: '#e2e8f0', color, '&:hover': { borderColor: color, bgcolor: `${color}10` },
  }) as const

  const showPicker = colDefs && colDefs.length > 0

  return (
    <Stack direction="row" spacing={1} alignItems="center">

      {showPicker && (
        <>
          <Button size="small" variant="outlined" onClick={e => setColAnchor(e.currentTarget)}
            startIcon={<ViewColumnIcon sx={{ fontSize: '17px !important' }} />}
            sx={{ ...btnSx(hiddenCols.size > 0 ? ACCENT : '#475569'),
                  borderColor: hiddenCols.size > 0 ? ACCENT : '#e2e8f0',
                  bgcolor: hiddenCols.size > 0 ? '#ede9fe' : 'transparent' }}>
            {tr('Columns')}{hiddenCols.size > 0 ? ` (${hiddenCols.size})` : ''}
          </Button>
          <Popover open={Boolean(colAnchor)} anchorEl={colAnchor} onClose={() => setColAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
            <Box sx={{ p: 1.5, minWidth: 210 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: 0.5 }}>COLUMNS</Typography>
                <Stack direction="row" spacing={0.5}>
                  <Button size="small" onClick={showAll} sx={{ fontSize: 10, py: 0, minWidth: 0, textTransform: 'none', color: ACCENT }}>{tr('Show All')}</Button>
                  {onResetColumns && <Button size="small" onClick={handleReset} sx={{ fontSize: 10, py: 0, minWidth: 0, textTransform: 'none', color: '#64748b' }}>{tr('Reset')}</Button>}
                </Stack>
              </Box>
              <Divider sx={{ mb: 0.75 }} />
              {colDefs.map(c => {
                const id = c.field ?? (c as any).colId ?? ''
                return id ? (
                  <FormControlLabel key={id}
                    control={<Checkbox size="small" checked={!hiddenCols.has(id)} onChange={e => toggleCol(id, e.target.checked)} sx={{ '&.Mui-checked': { color: ACCENT }, py: 0.25 }} />}
                    label={<Typography sx={{ fontSize: 12 }}>{tr(colLabel(c))}</Typography>}
                    sx={{ display: 'flex', ml: 0, mr: 0, mb: 0.25 }} />
                ) : null
              })}
            </Box>
          </Popover>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        </>
      )}

      <Button size="small" variant="outlined" disabled={!!exporting} onClick={exportExcel}
        startIcon={exporting === 'excel' ? <CircularProgress size={13} sx={{ color: '#16a34a' }} /> : <FileDownloadIcon sx={{ fontSize: '17px !important' }} />}
        sx={btnSx('#16a34a')}>{tr('Excel')}</Button>

      <Button size="small" variant="outlined" disabled={!!exporting} onClick={exportPdf}
        startIcon={exporting === 'pdf' ? <CircularProgress size={13} sx={{ color: '#dc2626' }} /> : <PictureAsPdfIcon sx={{ fontSize: '17px !important' }} />}
        sx={btnSx('#dc2626')}>{tr('PDF')}</Button>

      <Button size="small" variant="outlined" onClick={() => setEmailOpen(true)}
        startIcon={<EmailIcon sx={{ fontSize: '17px !important' }} />}
        sx={btnSx(ACCENT)}>{tr('Email')}</Button>

      {/* ── Email dialog ── */}
      <Dialog open={emailOpen} onClose={() => setEmailOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 800, fontSize: 17, pr: 6 }}>
          {tr('Email this report')}
          <IconButton onClick={() => setEmailOpen(false)} sx={{ position: 'absolute', right: 12, top: 12, color: '#64748b' }}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {isAdmin && (
              <ToggleButtonGroup exclusive size="small" fullWidth value={mode} onChange={(_, v) => v && setMode(v)}
                sx={{ '& .Mui-selected': { bgcolor: `${ACCENT}18 !important`, color: `${ACCENT} !important` } }}>
                <ToggleButton value="now" sx={{ textTransform: 'none', fontWeight: 600 }}>{tr('Send now')}</ToggleButton>
                <ToggleButton value="schedule" sx={{ textTransform: 'none', fontWeight: 600 }}>{tr('Schedule recurring')}</ToggleButton>
              </ToggleButtonGroup>
            )}
            {mode === 'now' && (
            <Box>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('Format')}</Typography>
              <ToggleButtonGroup exclusive size="small" value={fmt} onChange={(_, v) => v && setFmt(v)}
                sx={{ '& .Mui-selected': { bgcolor: `${ACCENT}18 !important`, color: `${ACCENT} !important` } }}>
                <ToggleButton value="pdf" sx={{ textTransform: 'none', px: 2 }}><PictureAsPdfIcon sx={{ fontSize: 16, mr: 0.7 }} />PDF</ToggleButton>
                <ToggleButton value="excel" sx={{ textTransform: 'none', px: 2 }}><FileDownloadIcon sx={{ fontSize: 16, mr: 0.7 }} />Excel</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            )}
            {mode === 'schedule' && (
            <>
            <Box>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('Report')}</Typography>
              <Select fullWidth size="small" value={schedType} onChange={e => setSchedType(String(e.target.value))}>
                {Object.entries(reportTypes).map(([k, label]) => <MenuItem key={k} value={k}>{label}</MenuItem>)}
              </Select>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('Frequency')}</Typography>
                <Select size="small" value={schedFreq} onChange={e => setSchedFreq(e.target.value as any)} sx={{ minWidth: 150 }}>
                  <MenuItem value="daily">{tr('Daily')}</MenuItem>
                  <MenuItem value="weekly">{tr('Weekly')}</MenuItem>
                  <MenuItem value="monthly">{tr('Monthly')}</MenuItem>
                  <MenuItem value="once">{tr('One time (on a date)')}</MenuItem>
                </Select>
              </Box>
              {schedFreq === 'weekly' && (
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('On')}</Typography>
                  <Select size="small" value={schedWeekday} onChange={e => setSchedWeekday(Number(e.target.value))} sx={{ minWidth: 130 }}>
                    {WEEKDAYS.map((d, i) => <MenuItem key={i} value={i}>{tr(d)}</MenuItem>)}
                  </Select>
                </Box>
              )}
              {schedFreq === 'monthly' && (
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('Day of month')}</Typography>
                  <TextField type="number" size="small" value={schedDay}
                    onChange={e => setSchedDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                    inputProps={{ min: 1, max: 31 }} sx={{ width: 110 }} />
                </Box>
              )}
              {schedFreq === 'once' && (
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('Date')}</Typography>
                  <TextField type="date" size="small" value={schedDate} onChange={e => setSchedDate(e.target.value)} InputLabelProps={{ shrink: true }} />
                </Box>
              )}
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('At')}</Typography>
                <TextField type="time" size="small" value={schedTime} onChange={e => setSchedTime(e.target.value)} sx={{ width: 120 }} />
              </Box>
            </Box>
            <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
              {tr('The report is emailed automatically on this schedule. Manage or remove it any time in Settings → Reports.')}
            </Typography>
            </>
            )}
            <Box>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('Subject / title')}</Typography>
              <TextField size="small" fullWidth value={subject} onChange={e => setSubject(e.target.value)} />
            </Box>
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>{tr('Recipients')}</Typography>
                {lists.length > 0 && (
                  <Select size="small" value="" displayEmpty onChange={e => {
                      const l = lists.find(x => x.name === e.target.value); if (!l) return
                      setRecipients(r => r ? `${r}, ${l.recipients}` : l.recipients)
                    }}
                    sx={{ height: 28, fontSize: 12, minWidth: 150 }}>
                    <MenuItem value="" disabled sx={{ fontSize: 12 }}>{tr('Insert saved list…')}</MenuItem>
                    {lists.map(l => <MenuItem key={l.name} value={l.name} sx={{ fontSize: 12 }}>{l.name}</MenuItem>)}
                  </Select>
                )}
              </Box>
              <TextField size="small" fullWidth multiline minRows={2} placeholder="a@example.com, b@example.com"
                value={recipients} onChange={e => setRecipients(e.target.value)} />
              <Button size="small" onClick={saveCurrentAsList} disabled={!recipients.trim()}
                sx={{ textTransform: 'none', fontSize: 11, color: ACCENT, mt: 0.5, minWidth: 0 }}>
                {tr('Save these as a list')}
              </Button>
            </Box>
            {mode === 'now' && (
            <Box>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('Message (optional)')}</Typography>
              <TextField size="small" fullWidth multiline minRows={2} value={note} onChange={e => setNote(e.target.value)} />
            </Box>
            )}
            <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
              {mode === 'schedule'
                ? tr('Uses the SMTP settings in Settings → Reports.')
                : tr('Uses the SMTP settings in Settings → Reports. The current filtered/visible columns are sent.')}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setEmailOpen(false)} sx={{ textTransform: 'none', color: '#64748b' }}>{tr('Cancel')}</Button>
          {mode === 'schedule' ? (
            <Button variant="contained" onClick={createSchedule} disabled={creating}
              startIcon={creating ? <CircularProgress size={14} color="inherit" /> : <HistoryIcon />}
              sx={{ textTransform: 'none', fontWeight: 700, bgcolor: ACCENT, '&:hover': { bgcolor: '#6d28d9' } }}>
              {creating ? tr('Creating…') : tr('Create schedule')}
            </Button>
          ) : (
            <Button variant="contained" onClick={sendEmail} disabled={sending}
              startIcon={sending ? <CircularProgress size={14} color="inherit" /> : <EmailIcon />}
              sx={{ textTransform: 'none', fontWeight: 700, bgcolor: ACCENT, '&:hover': { bgcolor: '#6d28d9' } }}>
              {sending ? tr('Sending…') : tr('Send now')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.sev} onClose={() => setToast(null)} sx={{ borderRadius: 2 }}>{toast.msg}</Alert> : undefined}
      </Snackbar>

    </Stack>
  )
}
