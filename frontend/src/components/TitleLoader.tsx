/**
 * TitleLoader — small inline "Loading…" pill shown beside a page title.
 * Visible whenever any React Query fetch is in flight (replaces the old
 * top-right header FetchingBadge).
 */
import { useIsFetching } from '@tanstack/react-query'
import { CircularProgress, Box, Typography } from '@mui/material'
import { tr } from '../i18n'

export default function TitleLoader() {
  const n = useIsFetching()
  if (!n) return null
  return (
    <Box component="span" sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5,
      ml: 1.5, px: 1, py: 0.25, borderRadius: 99,
      bgcolor: 'rgba(124,58,237,0.08)', verticalAlign: 'middle',
    }}>
      <CircularProgress size={12} thickness={5} sx={{ color: '#7c3aed' }} />
      <Typography component="span" sx={{ fontSize: 11, fontWeight: 600, color: '#7c3aed' }}>
        {tr('Loading…')}
      </Typography>
    </Box>
  )
}
