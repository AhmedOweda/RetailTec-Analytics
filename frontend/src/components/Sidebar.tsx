import { useState, useEffect } from 'react'
import {
  Box, Typography, TextField, Select, MenuItem, FormControl,
  InputLabel, Checkbox, FormControlLabel, Button, Divider,
  CircularProgress, ToggleButton, ToggleButtonGroup, Tooltip,
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFnsV3'
import { parseISO, format } from 'date-fns'
import RefreshIcon from '@mui/icons-material/Refresh'
import StorageIcon from '@mui/icons-material/Storage'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import StoreIcon from '@mui/icons-material/Store'
import TuneIcon from '@mui/icons-material/Tune'
import BoltIcon from '@mui/icons-material/Bolt'
import { useSubsidiaries, useStores } from '../hooks/useAnalytics'
import { PURPLE_BRAND } from '../theme'

const TTL_OPTIONS = [
  { label: '15m', value: 900 },
  { label: '30m', value: 1800 },
  { label: '1h',  value: 3600 },
  { label: '2h',  value: 7200 },
  { label: '8h',  value: 28800 },
  { label: '24h', value: 86400 },
]

const sx_input = {
  '& .MuiOutlinedInput-root': {
    color: '#E8DFFF',
    fontSize: '0.78rem',
    fontFamily: '"Manrope", sans-serif',
    '& fieldset': { borderColor: 'rgba(155,101,208,0.4)' },
    '&:hover fieldset': { borderColor: 'rgba(155,101,208,0.7)' },
    '&.Mui-focused fieldset': { borderColor: '#9B65D0' },
  },
  '& .MuiInputLabel-root': { color: '#9B65D0', fontSize: '0.72rem' },
  '& .MuiSvgIcon-root': { color: '#9B65D0' },
}

interface SidebarProps {
  host: string;       onHostChange: (v: string) => void
  dateFrom: string;   onDateFromChange: (v: string) => void
  dateTo: string;     onDateToChange: (v: string) => void
  stores: string[];   onStoresChange: (v: string[]) => void
  itemTypes: string;  onItemTypesChange: (v: string) => void
  cacheTtl: number;   onCacheTtlChange: (v: number) => void
  onRefresh: () => void
  isLoading: boolean
}

function SideSection({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 1 }}>
        <Box sx={{ color: '#9B65D0', display: 'flex', '& svg': { fontSize: 13 } }}>{icon}</Box>
        <Typography variant="subtitle2" sx={{ color: '#9B65D0', fontSize: '0.58rem', letterSpacing: '0.08em' }}>
          {label}
        </Typography>
      </Box>
      {children}
    </Box>
  )
}

export default function Sidebar(props: SidebarProps) {
  const { host, onHostChange, dateFrom, onDateFromChange, dateTo, onDateToChange,
          stores, onStoresChange, itemTypes, onItemTypesChange,
          cacheTtl, onCacheTtlChange, onRefresh, isLoading } = props

  const [localHost, setLocalHost] = useState(host)
  const [selSub, setSelSub]       = useState<string>('')

  const { data: subs }   = useSubsidiaries(host)
  const { data: allStores, isLoading: storesLoading } = useStores(host, selSub || null)

  // Auto-select first subsidiary on load
  useEffect(() => {
    if (subs?.length && !selSub) {
      setSelSub(subs[0].SID)
    }
  }, [subs])

  // Auto-select first store only (keeps initial query small)
  useEffect(() => {
    if (allStores?.length && stores.length === 0) {
      onStoresChange([allStores[0].STORE_NAME])
    }
  }, [allStores])

  const allSelected = !!allStores?.length && stores.length === allStores.length

  const toggleStore = (name: string) => {
    onStoresChange(stores.includes(name) ? stores.filter(s => s !== name) : [...stores, name])
  }

  const sideBg = `linear-gradient(180deg, ${PURPLE_BRAND[900]}, ${PURPLE_BRAND[800]})`

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box sx={{
        width: 240, flexShrink: 0,
        background: sideBg,
        display: 'flex', flexDirection: 'column', height: '100%',
        overflowY: 'auto',
      }}>
        {/* Brand header */}
        <Box sx={{ p: '14px 16px', borderBottom: '1px solid rgba(155,101,208,0.2)', display: 'flex', alignItems: 'center' }}>
          <img src="/logo-white.png" alt="RetailTec" style={{ height: 36, width: 'auto' }} />
        </Box>

        {/* Scrollable content */}
        <Box sx={{ flex: 1, p: '14px 14px', overflowY: 'auto' }}>

          {/* Oracle Server */}
          <SideSection icon={<StorageIcon />} label="ORACLE SERVER">
            <Box sx={{ display: 'flex', gap: 0.8 }}>
              <TextField
                size="small" fullWidth
                value={localHost}
                onChange={e => setLocalHost(e.target.value)}
                placeholder="192.168.1.10"
                sx={sx_input}
              />
              <Tooltip title="Apply">
                <Button
                  size="small" variant="contained" onClick={() => onHostChange(localHost)}
                  sx={{ minWidth: 32, px: 1, py: 0.5, fontSize: '0.75rem', background: 'rgba(112,64,184,0.5)' }}
                >✓</Button>
              </Tooltip>
            </Box>
            <Typography variant="caption" sx={{ color: '#6B5A8E', display: 'block', mt: 0.5, fontFamily: '"DM Mono", monospace' }}>
              {host}
            </Typography>
          </SideSection>

          <Divider sx={{ borderColor: 'rgba(155,101,208,0.2)', my: 1.5 }} />

          {/* Date Range */}
          <SideSection icon={<CalendarMonthIcon />} label="DATE RANGE">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <DatePicker
                label="From"
                value={parseISO(dateFrom)}
                onChange={d => d && onDateFromChange(format(d, 'yyyy-MM-dd'))}
                maxDate={parseISO(dateTo)}
                slotProps={{ textField: { size: 'small', fullWidth: true, sx: sx_input } }}
              />
              <DatePicker
                label="To"
                value={parseISO(dateTo)}
                onChange={d => d && onDateToChange(format(d, 'yyyy-MM-dd'))}
                minDate={parseISO(dateFrom)}
                maxDate={new Date()}
                slotProps={{ textField: { size: 'small', fullWidth: true, sx: sx_input } }}
              />
            </Box>
          </SideSection>

          <Divider sx={{ borderColor: 'rgba(155,101,208,0.2)', my: 1.5 }} />

          {/* Subsidiary */}
          {subs && subs.length > 0 && (
            <>
              <SideSection icon={<span style={{ fontSize: 12 }}>🏢</span>} label="SUBSIDIARY">
                <FormControl fullWidth size="small" sx={sx_input}>
                  <InputLabel>All Subsidiaries</InputLabel>
                  <Select
                    value={selSub}
                    label="All Subsidiaries"
                    onChange={e => { setSelSub(e.target.value as string); onStoresChange([]) }}
                    MenuProps={{ PaperProps: { sx: { background: PURPLE_BRAND[800], color: '#E8DFFF' } } }}
                  >
                    <MenuItem value="">— All —</MenuItem>
                    {subs.map(s => (
                      <MenuItem key={s.SID} value={s.SID} sx={{ fontSize: '0.78rem' }}>{s.DESCRIPTION}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </SideSection>
              <Divider sx={{ borderColor: 'rgba(155,101,208,0.2)', my: 1.5 }} />
            </>
          )}

          {/* Stores */}
          <SideSection icon={<StoreIcon />} label={`STORES (${stores.length}/${allStores?.length ?? 0})`}>
            {storesLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                <CircularProgress size={14} sx={{ color: '#9B65D0' }} />
                <Typography sx={{ fontSize: '0.72rem', color: '#9B65D0' }}>Loading…</Typography>
              </Box>
            ) : (
              <>
                <Button
                  size="small" fullWidth
                  onClick={() => onStoresChange(allSelected ? [] : (allStores ?? []).map(s => s.STORE_NAME))}
                  sx={{
                    mb: 0.8, fontSize: '0.65rem', fontWeight: 700,
                    color: allSelected ? '#fff' : '#C8A8E8',
                    background: allSelected ? 'rgba(112,64,184,0.45)' : 'rgba(78,42,153,0.25)',
                    border: '1px solid rgba(155,101,208,0.4)',
                    '&:hover': { background: 'rgba(112,64,184,0.55)' },
                  }}
                >
                  {allSelected ? '☑ Deselect All' : '☐ Select All'}
                </Button>
                <Box sx={{ maxHeight: 160, overflowY: 'auto' }}>
                  {allStores?.map(s => (
                    <FormControlLabel
                      key={s.STORE_NAME}
                      control={
                        <Checkbox
                          checked={stores.includes(s.STORE_NAME)}
                          onChange={() => toggleStore(s.STORE_NAME)}
                          size="small"
                          sx={{ color: '#9B65D0', '&.Mui-checked': { color: '#9B65D0' }, p: 0.3 }}
                        />
                      }
                      label={s.STORE_NAME}
                      sx={{
                        display: 'flex', alignItems: 'center', m: 0, py: 0.2,
                        '& .MuiFormControlLabel-label': {
                          fontSize: '0.68rem', color: '#C8A8E8',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        },
                      }}
                    />
                  ))}
                </Box>
              </>
            )}
          </SideSection>

          <Divider sx={{ borderColor: 'rgba(155,101,208,0.2)', my: 1.5 }} />

          {/* Options */}
          <SideSection icon={<TuneIcon />} label="OPTIONS">
            <FormControlLabel
              control={
                <Checkbox
                  checked={itemTypes === '1,2,3'}
                  onChange={e => onItemTypesChange(e.target.checked ? '1,2,3' : '1,2')}
                  size="small"
                  sx={{ color: '#9B65D0', '&.Mui-checked': { color: '#9B65D0' }, p: 0.3 }}
                />
              }
              label="Include Orders (type 3)"
              sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.70rem', color: '#C8A8E8' } }}
            />
          </SideSection>

          <Divider sx={{ borderColor: 'rgba(155,101,208,0.2)', my: 1.5 }} />

          {/* Cache TTL */}
          <SideSection icon={<BoltIcon />} label="CACHE TTL">
            <ToggleButtonGroup
              value={cacheTtl} exclusive
              onChange={(_, v) => v && onCacheTtlChange(v)}
              size="small"
              sx={{ flexWrap: 'wrap', gap: 0.5, '& .MuiToggleButtonGroup-grouped': { border: 'none !important', borderRadius: '6px !important' } }}
            >
              {TTL_OPTIONS.map(o => (
                <ToggleButton
                  key={o.value} value={o.value}
                  sx={{
                    color: '#9B65D0', fontSize: '0.63rem', fontWeight: 700, px: 1, py: 0.4,
                    background: 'rgba(78,42,153,0.3)', border: '1px solid rgba(155,101,208,0.3) !important',
                    borderRadius: '6px !important',
                    '&.Mui-selected': { background: '#7040B8 !important', color: '#fff', border: '1px solid #9B65D0 !important' },
                    '&:hover': { background: 'rgba(112,64,184,0.4)' },
                  }}
                >
                  {o.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </SideSection>
        </Box>

        {/* Refresh button */}
        <Box sx={{ p: '12px 14px', borderTop: '1px solid rgba(155,101,208,0.2)' }}>
          <Button
            fullWidth variant="contained" onClick={onRefresh} disabled={isLoading}
            startIcon={isLoading ? <CircularProgress size={13} color="inherit" /> : <RefreshIcon sx={{ fontSize: '14px !important' }} />}
            sx={{
              py: 1, fontWeight: 700, fontSize: '0.78rem',
              background: isLoading ? 'rgba(112,64,184,0.4)' : 'linear-gradient(135deg,#7040B8,#9B65D0)',
              boxShadow: '0 4px 14px rgba(112,64,184,0.35)',
              '&:hover': { boxShadow: '0 6px 20px rgba(112,64,184,0.45)', background: 'linear-gradient(135deg,#8050C8,#AB75E0)' },
              '&.Mui-disabled': { color: 'rgba(255,255,255,0.4)' },
            }}
          >
            {isLoading ? 'Loading…' : 'Refresh Data'}
          </Button>
        </Box>
      </Box>
    </LocalizationProvider>
  )
}
