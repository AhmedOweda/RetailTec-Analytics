/**
 * SavedViewsBar — a compact "Views" control: pick a saved view to apply, or
 * save the current filters under a name. Backed by useSavedViews (localStorage).
 */
import { useState } from 'react'
import {
  Box, Button, Menu, MenuItem, IconButton, TextField, Tooltip, Divider, Typography,
} from '@mui/material'
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder'
import DeleteOutlineIcon  from '@mui/icons-material/DeleteOutline'
import AddIcon            from '@mui/icons-material/Add'
import { useSavedViews } from '../hooks/useSavedViews'
import { tr } from '../i18n'

const ACCENT = '#7c3aed'

export default function SavedViewsBar({ pageKey, current, onApply }: {
  pageKey: string
  current: any
  onApply: (state: any) => void
}) {
  const { views, save, remove } = useSavedViews(pageKey)
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName]     = useState('')

  const doSave = () => { save(name, current); setName(''); setNaming(false) }

  return (
    <>
      <Button size="small" variant="outlined" startIcon={<BookmarkBorderIcon sx={{ fontSize: 16 }} />}
        onClick={e => setAnchor(e.currentTarget)}
        sx={{ textTransform: 'none', borderColor: '#e2e8f0', color: '#475569', fontWeight: 600 }}>
        {tr('Views')}{views.length ? ` (${views.length})` : ''}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => { setAnchor(null); setNaming(false) }}
        PaperProps={{ sx: { minWidth: 240, borderRadius: 2 } }}>
        {views.length === 0 && (
          <Typography sx={{ px: 2, py: 1, fontSize: 12, color: '#94a3b8' }}>{tr('No saved views yet')}</Typography>
        )}
        {views.map(v => (
          <MenuItem key={v.name} onClick={() => { onApply(v.state); setAnchor(null) }}
            sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, fontSize: 13 }}>
            <span>{v.name}</span>
            <IconButton size="small" onClick={e => { e.stopPropagation(); remove(v.name) }}>
              <DeleteOutlineIcon sx={{ fontSize: 16, color: '#ef4444' }} />
            </IconButton>
          </MenuItem>
        ))}
        <Divider />
        {naming ? (
          <Box sx={{ p: 1, display: 'flex', gap: 1 }}>
            <TextField autoFocus size="small" placeholder={tr('View name')} value={name}
              onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doSave() }}
              sx={{ flex: 1 }} />
            <Button size="small" variant="contained" onClick={doSave} disabled={!name.trim()}
              sx={{ textTransform: 'none', bgcolor: ACCENT, '&:hover': { bgcolor: '#6d28d9' } }}>{tr('Save')}</Button>
          </Box>
        ) : (
          <MenuItem onClick={() => setNaming(true)} sx={{ fontSize: 13, color: ACCENT, fontWeight: 600 }}>
            <AddIcon sx={{ fontSize: 16, mr: 1 }} />{tr('Save current filters')}
          </MenuItem>
        )}
      </Menu>
    </>
  )
}
