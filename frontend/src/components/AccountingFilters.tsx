/**
 * AccountingFilters — the two report-wide controls shared by all four
 * Accounting pages (Journal, Trial Balance, General Ledger, Exceptions).
 * =====================================================================
 * ONE definition, four pages. These are not cosmetic toggles: each one changes
 * which rows the server returns, so they must look and behave identically
 * everywhere or the same report reads differently on two screens.
 *
 * ── DateBasisToggle ─────────────────────────────────────────────────────────
 * Two genuinely different dates live on every GL line:
 *   Transaction — when the business activity happened (the period it belongs
 *                 to).  DEFAULT.
 *   Posting     — when the entry was migrated into the books.
 * On production they differ by MONTHS (January activity posted in July), so
 * which one the date window filters on materially changes every figure. It is
 * therefore always visible, never hidden in a menu — the same reasoning as the
 * balanced-document gate.
 *
 * ── JournalCategoryFilter ───────────────────────────────────────────────────
 * THREE-WAY (2026-07-22). Derived server-side; this is just the picker:
 *   Payment     — SRC_DOC_TYPE beginning 'P_' (nets to zero by design).
 *   Transaction — has a source document: the integration's Sale / Return /
 *                 Purchase / Transfer Slips journals.
 *   Entry       — NO source document: a journal the accountant keyed directly
 *                 into Prism (payroll, rent, accruals).
 *
 * Both values are sent verbatim as the `date_basis` / `journal_category` query
 * params, which the backend validates against a whitelist — the UI is a
 * convenience, never the security boundary.
 *
 * Colours are --rt-* design tokens only, so dark mode and RTL are automatic.
 * Labels go through tr() (EN + AR entries live in i18n.ts).
 */
import { ToggleButton, ToggleButtonGroup, Typography, Box } from '@mui/material'
import { tr } from '../i18n'

/** The two date bases, matching the backend's _DATE_BASIS whitelist keys. */
export type DateBasis = 'transaction' | 'posting'
export const DEFAULT_DATE_BASIS: DateBasis = 'transaction'

/** All / Payment / Transaction / Entry, matching the backend's
 *  _JOURNAL_CATEGORIES keys. '' means "no filter" and is simply omitted from
 *  the request. NOTE: before 2026-07-22 'entry' meant "everything that is not
 *  a payment"; it now means MANUAL entries only — saved views carry a
 *  journalCatV marker so the old meaning restores as 'transaction'. */
export type JournalCategory = '' | 'payment' | 'transaction' | 'entry'

/** Restore a saved-view / URL category under the new taxonomy. Views saved
 *  before the three-way split (no journalCatV marker) used 'entry' to mean
 *  the integration's transaction journals, so that exact value maps to
 *  'transaction'; anything unrecognised falls back to All. */
export function restoreJournalCategory(value: any, marker: any): JournalCategory {
  if (value === 'payment' || value === 'transaction') return value
  if (value === 'entry') return marker === 2 ? 'entry' : 'transaction'
  return ''
}

/** Shared look for both groups — small, quiet, and unmistakably a choice. */
const GROUP_SX = {
  '& .MuiToggleButton-root': {
    textTransform: 'none',
    fontSize: 11.5,
    fontWeight: 600,
    px: 1.2,
    py: 0.35,
    color: 'var(--rt-text-2)',
    borderColor: 'var(--rt-border)',
  },
  // --rt-surface-3 is the documented "hover / active / chip fills" token.
  '& .MuiToggleButton-root.Mui-selected': {
    bgcolor: 'var(--rt-surface-3)',
    color: 'var(--rt-text)',
  },
  '& .MuiToggleButton-root.Mui-selected:hover': {
    bgcolor: 'var(--rt-surface-3)',
  },
} as const

const LABEL_SX = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--rt-text-2)',
  whiteSpace: 'nowrap',
} as const

export function DateBasisToggle({
  value, onChange,
}: { value: DateBasis; onChange: (v: DateBasis) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
      <Typography sx={LABEL_SX}>{tr('Date basis')}</Typography>
      <ToggleButtonGroup
        exclusive size="small" value={value} sx={GROUP_SX}
        // Ignore a null value: MUI emits it when the active button is clicked
        // again, and there is no meaningful "no basis" state.
        onChange={(_, v) => { if (v) onChange(v as DateBasis) }}>
        {/* 'Transaction date' / 'Posting date', not the bare words: the bare
            key 'Transaction' now belongs to the journal CATEGORY (a different
            Arabic word), and one flat tr() dictionary cannot give one English
            key two translations. */}
        <ToggleButton value="transaction" title={tr('Filter by the date the activity happened')}>
          {tr('Transaction date')}
        </ToggleButton>
        <ToggleButton value="posting" title={tr('Filter by the date the entry reached the books')}>
          {tr('Posting date')}
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  )
}

export function JournalCategoryFilter({
  value, onChange,
}: { value: JournalCategory; onChange: (v: JournalCategory) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
      {/* 'Journal Category', not 'Journal': the latter is already the page
          title's translation and would read as a heading, not a filter. */}
      <Typography sx={LABEL_SX}>{tr('Journal Category')}</Typography>
      <ToggleButtonGroup
        exclusive size="small" value={value} sx={GROUP_SX}
        onChange={(_, v) => onChange((v ?? '') as JournalCategory)}>
        <ToggleButton value="">{tr('All')}</ToggleButton>
        <ToggleButton value="payment">{tr('Payment')}</ToggleButton>
        <ToggleButton value="transaction">{tr('Transaction')}</ToggleButton>
        <ToggleButton value="entry">{tr('Entry')}</ToggleButton>
      </ToggleButtonGroup>
    </Box>
  )
}

/** Human summary of the active basis, for the export/email "filters" line. */
export function dateBasisLabel(b: DateBasis): string {
  return b === 'posting' ? tr('Posting date') : tr('Transaction date')
}

/** Human summary of the active category filter. */
export function journalCategoryLabel(c: JournalCategory): string {
  if (c === 'payment')     return tr('Payment journals only')
  if (c === 'transaction') return tr('Transaction journals only')
  if (c === 'entry')       return tr('Manual entries only')
  return tr('All journals')
}
