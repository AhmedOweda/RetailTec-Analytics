/**
 * Audit Log — admin-only page
 * Read-only viewer over GET /api/admin/audit?limit=N (newest first).
 * Rows: { ts, username, action, detail }. Action codes get a friendly,
 * translated, colour-coded chip. Mirrors the flat-grid style used across
 * the analytics pages (AG Grid + GridExportBar).
 */
import { useRef, useMemo, useState } from 'react'
import { Box, Typography, Stack, Button, Select, MenuItem, FormControl, InputLabel, Alert, TextField } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import api from '../../api/client'
import GridExportBar from '../../components/GridExportBar'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { tr, trf, trCols } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'

interface AuditRow {
  ts:       string
  username: string
  action:   string
  detail:   string
}

const C_GREEN = '#059669'
const C_ROSE  = '#e11d48'
const C_AMBER = '#d97706'
const C_SLATE = '#64748b'

// Action code → chip colour hint.
const ACTION_COLOR: Record<string, string> = {
  login:                  C_GREEN,
  login_failed:           C_ROSE,
  change_password:        C_GREEN,
  user_created:           C_GREEN,
  user_updated:           C_AMBER,
  user_deleted:           C_ROSE,
  backup:                 C_AMBER,
  compact_db:             C_AMBER,
  email_settings_saved:   C_AMBER,
  report_schedules_saved: C_AMBER,
  range_load:             C_AMBER,
}

// Action code → friendly label (English source; tr() supplies Arabic).
const ACTION_LABEL: Record<string, string> = {
  login:                  'Login',
  login_failed:           'Login failed',
  change_password:        'Change password',
  user_created:           'User created',
  user_updated:           'User updated',
  user_deleted:           'User deleted',
  backup:                 'Backup',
  compact_db:             'Compact database',
  email_settings_saved:   'Email settings saved',
  report_schedules_saved: 'Report schedules saved',
  range_load:             'Range load',
}

// Readable local time, Western digits.
function fmtTime(v: any): string {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return String(v)
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

const LIMITS = [100, 500, 1000, 5000]

export default function AuditLog() {
  const qc = useQueryClient()
  const gridRef = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('audit-log')
  const [limit, setLimit] = useState(500)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

  const { data: rows = [], isLoading, error } = useQuery<AuditRow[]>({
    queryKey: ['audit', limit, dateFrom, dateTo],
    queryFn:  () => {
      const qs = new URLSearchParams({ limit: String(limit) })
      if (dateFrom) qs.set('date_from', dateFrom)
      if (dateTo)   qs.set('date_to',   dateTo)
      return api.get('/api/admin/audit?' + qs.toString()).then(r => r.data)
    },
  })

  const colDefs = useMemo<any[]>(() => [
    { field: 'ts', headerName: 'Time', width: 190, valueFormatter: (p: any) => fmtTime(p.value),
      cellStyle: { color: C_SLATE }, sort: 'desc' as const },
    { field: 'username', headerName: 'User', width: 150, cellStyle: { fontWeight: 600 } },
    { field: 'action', headerName: 'Action', width: 190,
      valueFormatter: (p: any) => tr(ACTION_LABEL[p.value] ?? p.value ?? ''),
      cellRenderer: (p: any) => {
        const code  = p.value ?? ''
        const c     = ACTION_COLOR[code] ?? C_SLATE
        const label = tr(ACTION_LABEL[code] ?? code)
        return <span style={{ background: `${c}18`, color: c, border: `1px solid ${c}55`,
          borderRadius: '12px', padding: '2px 10px', fontSize: '11px', fontWeight: 700 }}>{label || '—'}</span>
      } },
    { field: 'detail', headerName: 'Detail', flex: 1, minWidth: 220,
      wrapText: true, autoHeight: true, cellStyle: { whiteSpace: 'normal', lineHeight: '1.4' } },
  ], [])

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3 }}>
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor:'#f8fafc',
                 mx:-3, px:3, pt:2.5, pb:1.5, mb:2, borderBottom:'1px solid #e9e4ff' }}>
        <Typography variant="h5" fontWeight={700} mb={0.3}>{tr('Audit Log')}<TitleLoader /></Typography>
        <Typography sx={{ fontSize:12, color:'#64748b', mb:1.5 }}>
          {tr('Logins, user changes, settings and data actions')}
        </Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>{tr('Rows')}</InputLabel>
            <Select value={limit} label={tr('Rows')}
              onChange={e => setLimit(Number(e.target.value))}>
              {LIMITS.map(n => (
                <MenuItem key={n} value={n}>{trf('Last {{n}}', { n })}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField type="date" size="small" label={tr('From')} value={dateFrom}
            onChange={e => setDateFrom(e.target.value)} InputLabelProps={{ shrink: true }}
            sx={{ width: 150 }} />
          <TextField type="date" size="small" label={tr('To')} value={dateTo}
            onChange={e => setDateTo(e.target.value)} InputLabelProps={{ shrink: true }}
            sx={{ width: 150 }} />
          {(dateFrom || dateTo) && (
            <Button size="small" onClick={() => { setDateFrom(''); setDateTo('') }}
              sx={{ textTransform:'none', color:'#64748b', minWidth:0 }}>{tr('Clear')}</Button>
          )}
          <Button size="small" variant="outlined" startIcon={<RefreshIcon sx={{ fontSize: '17px !important' }} />}
            onClick={() => qc.invalidateQueries({ queryKey: ['audit'] })}
            sx={{ textTransform:'none', borderRadius:2, fontWeight:600, height:32,
                  borderColor:'#e2e8f0', color:'#475569',
                  '&:hover':{ borderColor:'#7c3aed', color:'#7c3aed', bgcolor:'#ede9fe' } }}>
            {tr('Refresh')}
          </Button>
        </Stack>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{tr('Failed to load audit log')}</Alert>}

      <Box sx={{ bgcolor:'#fff', borderRadius:2, border:'1px solid #e2e8f0', p:2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
          <Typography sx={{ fontWeight:700, fontSize:13 }}>
            {trf('{{n}} events', { n: rows.length })}
          </Typography>
          <GridExportBar gridRef={gridRef} filename="audit_log" title="Audit Log"
            colDefs={colDefs} onResetColumns={resetColumns} />
        </Stack>
        <div className="ag-theme-alpine" style={{ height: 560 }}>
          <AgGridReact ref={gridRef} rowData={rows} columnDefs={trCols(colDefs as any[])}
            loading={isLoading}
            overlayNoRowsTemplate={noRowsOverlay()}
            defaultColDef={{ sortable:true, resizable:true, filter:true, wrapHeaderText:true, autoHeaderHeight:true }}
            rowHeight={36} headerHeight={38} suppressCellFocus
            onGridReady={onColGridReady} onColumnMoved={onColumnChanged}
            onColumnResized={onColumnChanged} onColumnVisible={onColumnChanged} />
        </div>
      </Box>
    </Box>
  )
}
