/**
 * GridExportBar — reusable AG Grid toolbar
 * ✦ Column show/hide picker  ✦ Excel (XLSX)  ✦ PDF
 *
 * Usage:
 *   const gridRef = useRef<AgGridReact>(null)
 *   <GridExportBar
 *     gridRef={gridRef}
 *     filename="stores"
 *     title="Store Intelligence"
 *     colDefs={colDefs}           // pass to enable column picker
 *     onResetColumns={resetColumns} // optional: from useGridColumnState
 *   />
 */
import { useState } from 'react'
import {
  Box, Button, Stack, Popover, FormControlLabel,
  Checkbox, Divider, CircularProgress, Typography,
} from '@mui/material'
import FileDownloadIcon  from '@mui/icons-material/FileDownload'
import PictureAsPdfIcon  from '@mui/icons-material/PictureAsPdf'
import ViewColumnIcon    from '@mui/icons-material/ViewColumn'
import type { AgGridReact } from 'ag-grid-react'
import type { ColDef }      from 'ag-grid-community'
import * as XLSX from 'xlsx'
import jsPDF     from 'jspdf'
import autoTable from 'jspdf-autotable'
import { tr }    from '../i18n'

const ACCENT = '#7c3aed'

interface Props {
  gridRef:          React.RefObject<AgGridReact>
  filename:         string
  title?:           string
  subtitle?:        string
  /** Pass to enable the column picker */
  colDefs?:         ColDef[]
  /** Optional callback from useGridColumnState */
  onResetColumns?:  () => void
}

export default function GridExportBar({
  gridRef, filename, title, subtitle, colDefs, onResetColumns,
}: Props) {

  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [colAnchor,  setColAnchor ] = useState<HTMLElement | null>(null)
  const [exporting,  setExporting ] = useState<'excel' | 'pdf' | null>(null)

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

  const handleReset = () => {
    onResetColumns?.()
    setHiddenCols(new Set())
    setColAnchor(null)
  }

  /* ── Helpers ──────────────────────────────────────────────────── */
  const colLabel = (c: ColDef): string =>
    (typeof c.headerName === 'string' ? c.headerName : null) ??
    c.field ?? (c as any).colId ?? 'Column'

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

  /* ── Excel export ─────────────────────────────────────────────── */
  const exportExcel = async () => {
    setExporting('excel')
    try {
      const cols = getVisibleColInfo()
      const rows = getRowsAfterFilter()
      const ws = XLSX.utils.json_to_sheet(
        rows.map((r: any) => Object.fromEntries(cols.map(c => {
          const api = gridRef.current?.api
          const vf  = api ? (api.getColumnDef(c.id) as any)?.valueFormatter : null
          const raw = r[c.id]
          const val = vf ? (vf({ value: raw, data: r, colDef: {} }) ?? raw ?? '') : (raw ?? '')
          return [c.label, val]
        })))
      )
      ws['!cols'] = cols.map(() => ({ wch: 14 }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Data')
      XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } finally { setExporting(null) }
  }

  /* ── PDF export ───────────────────────────────────────────────── */
  const exportPdf = async () => {
    setExporting('pdf')
    try {
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
      const W = 420
      doc.setFillColor(22, 11, 51)
      doc.rect(0, 0, W, 24, 'F')
      doc.setTextColor(255, 255, 255); doc.setFontSize(13); doc.setFont('helvetica', 'bold')
      doc.text(title ?? filename, 14, 10)
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(180, 160, 255)
      doc.text(subtitle ?? `Generated ${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`, 14, 17)
      doc.setTextColor(124, 58, 237); doc.setFontSize(10); doc.setFont('helvetica', 'bold')
      doc.text('RetailTec · Prism Analytics', W - 14, 10, { align: 'right' })
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(160, 140, 200)
      doc.text('Confidential — Internal Use Only', W - 14, 17, { align: 'right' })

      autoTable(doc, {
        startY: 28,
        head:  [cols.map(c => c.label)],
        body:   bodyRows,
        theme: 'grid',
        styles: { fontSize: 6.5, cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
          lineColor: [226, 232, 240], lineWidth: 0.3, textColor: [15, 23, 42], font: 'helvetica' },
        headStyles: { fillColor: [124, 58, 237], textColor: [255, 255, 255],
          fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: cols.reduce((acc: any, c, i) => {
          if (c.type === 'numericColumn') acc[i] = { halign: 'right' }
          return acc
        }, {}),
        didDrawPage: (data: any) => {
          const pH = doc.internal.pageSize.getHeight()
          doc.setFillColor(248, 250, 252)
          doc.rect(0, pH - 10, W, 10, 'F')
          doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
          doc.text(`Page ${data.pageNumber}`, 14, pH - 3)
          doc.text(`${title ?? filename}  ·  ${new Date().toLocaleString('en-GB')}`, W / 2, pH - 3, { align: 'center' })
          doc.text(`Total rows: ${bodyRows.length}`, W - 14, pH - 3, { align: 'right' })
        },
      })
      doc.save(`${filename}_${new Date().toISOString().slice(0, 10)}.pdf`)
    } finally { setExporting(null) }
  }

  /* ── Render ───────────────────────────────────────────────────── */
  const showPicker = colDefs && colDefs.length > 0

  return (
    <Stack direction="row" spacing={1} alignItems="center">

      {/* ── Column picker ── */}
      {showPicker && (
        <>
          <Button size="small" variant="outlined"
            onClick={e => setColAnchor(e.currentTarget)}
            startIcon={<ViewColumnIcon sx={{ fontSize: '17px !important' }} />}
            sx={{
              textTransform: 'none', borderRadius: 2, fontWeight: 600, height: 32,
              borderColor: hiddenCols.size > 0 ? ACCENT : '#e2e8f0',
              color:       hiddenCols.size > 0 ? ACCENT : '#475569',
              bgcolor:     hiddenCols.size > 0 ? '#ede9fe' : 'transparent',
              '&:hover': { borderColor: ACCENT, color: ACCENT, bgcolor: '#ede9fe' },
            }}
          >
            {tr('Columns')}{hiddenCols.size > 0 ? ` (${hiddenCols.size})` : ''}
          </Button>

          <Popover open={Boolean(colAnchor)} anchorEl={colAnchor} onClose={() => setColAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
            <Box sx={{ p: 1.5, minWidth: 210 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: 0.5 }}>
                  COLUMNS
                </Typography>
                <Stack direction="row" spacing={0.5}>
                  <Button size="small" onClick={showAll}
                    sx={{ fontSize: 10, py: 0, minWidth: 0, textTransform: 'none', color: ACCENT }}>
                    {tr('Show All')}
                  </Button>
                  {onResetColumns && (
                    <Button size="small" onClick={handleReset}
                      sx={{ fontSize: 10, py: 0, minWidth: 0, textTransform: 'none', color: '#64748b' }}>
                      {tr('Reset')}
                    </Button>
                  )}
                </Stack>
              </Box>
              <Divider sx={{ mb: 0.75 }} />
              {colDefs.map(c => {
                const id = c.field ?? (c as any).colId ?? ''
                return id ? (
                  <FormControlLabel key={id}
                    control={
                      <Checkbox size="small" checked={!hiddenCols.has(id)}
                        onChange={e => toggleCol(id, e.target.checked)}
                        sx={{ '&.Mui-checked': { color: ACCENT }, py: 0.25 }} />
                    }
                    label={<Typography sx={{ fontSize: 12 }}>{tr(colLabel(c))}</Typography>}
                    sx={{ display: 'flex', ml: 0, mr: 0, mb: 0.25 }}
                  />
                ) : null
              })}
            </Box>
          </Popover>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        </>
      )}

      {/* ── Excel ── */}
      <Button size="small" variant="outlined" disabled={!!exporting} onClick={exportExcel}
        startIcon={exporting === 'excel'
          ? <CircularProgress size={13} sx={{ color: '#16a34a' }} />
          : <FileDownloadIcon sx={{ fontSize: '17px !important' }} />}
        sx={{
          textTransform: 'none', borderRadius: 2, fontWeight: 600, height: 32,
          borderColor: '#e2e8f0', color: '#16a34a',
          '&:hover': { borderColor: '#16a34a', bgcolor: '#f0fdf4' },
        }}
      >{tr('Excel')}</Button>

      {/* ── PDF ── */}
      <Button size="small" variant="outlined" disabled={!!exporting} onClick={exportPdf}
        startIcon={exporting === 'pdf'
          ? <CircularProgress size={13} sx={{ color: '#dc2626' }} />
          : <PictureAsPdfIcon sx={{ fontSize: '17px !important' }} />}
        sx={{
          textTransform: 'none', borderRadius: 2, fontWeight: 600, height: 32,
          borderColor: '#e2e8f0', color: '#dc2626',
          '&:hover': { borderColor: '#dc2626', bgcolor: '#fff5f5' },
        }}
      >{tr('PDF')}</Button>

    </Stack>
  )
}
