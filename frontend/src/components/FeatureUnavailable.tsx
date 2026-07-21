/**
 * FeatureUnavailable — calm "this customisation is not installed here" panel.
 * ==========================================================================
 * Shown on pages whose data comes from an OPTIONAL Retail Pro customisation
 * that this particular Prism server does not have. This is a configuration
 * fact, NOT an error, so it is styled with the muted/informational tokens
 * (surface + border + text-2) — never the negative/error colour. Every colour
 * comes from a var(--rt-*) token so it reads correctly in light and dark mode.
 *
 * `variant`:
 *   'panel'  — the page's whole content is unavailable (History, Stock by Date,
 *              the four Accounting pages). Replaces the body.
 *   'banner' — only PART of the page is affected (Ledger: opening/ending
 *              balances need the history, the movement columns do not), so the
 *              real grid stays visible underneath.
 */
import { Box, Typography } from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { tr } from '../i18n'

const HINT = 'Ask your administrator — Settings → Diagnostics lists which optional Retail Pro customisations were detected on this server.'

export default function FeatureUnavailable({
  title, reason, variant = 'panel',
}: {
  title: string
  reason: string
  variant?: 'panel' | 'banner'
}) {
  const banner = variant === 'banner'
  return (
    <Box sx={{
      display: 'flex', gap: 1.5, alignItems: 'flex-start',
      bgcolor: 'var(--rt-surface)',
      border: '1px solid var(--rt-border)',
      borderRadius: 2,
      px: banner ? 2 : 4,
      py: banner ? 1.5 : 5,
      my: banner ? 0 : 4,
      mb: banner ? 2 : 4,
      mx: 'auto',
      maxWidth: banner ? '100%' : 620,
      textAlign: 'start',
    }}>
      <InfoOutlinedIcon sx={{ fontSize: banner ? 20 : 26, color: 'var(--rt-text-2)', mt: 0.2, flexShrink: 0 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{
          fontSize: banner ? 13 : 16, fontWeight: 700,
          color: 'var(--rt-text)', mb: 0.5,
        }}>
          {tr(title)}
        </Typography>
        <Typography sx={{ fontSize: banner ? 12 : 13.5, color: 'var(--rt-text-2)', lineHeight: 1.6 }}>
          {tr(reason)}
        </Typography>
        {!banner && (
          <Typography sx={{ fontSize: 12.5, color: 'var(--rt-text-2)', opacity: 0.85, mt: 1.5, lineHeight: 1.6 }}>
            {tr(HINT)}
          </Typography>
        )}
      </Box>
    </Box>
  )
}
