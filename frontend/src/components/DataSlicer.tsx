/**
 * DataSlicer — THE shared slicer. One component, one contract, one look.
 * =====================================================================
 * Supersedes the old `MultiSlicer`. Every page filter (customer, item,
 * dept/class/subclass, account, document type, …) must be built from this so
 * the same filter has identical shape, data and behaviour everywhere.
 * If you need a behaviour it does not have, ADD A PROP HERE — do not fork it.
 *
 * ── Prop contract ────────────────────────────────────────────────────────────
 *  value            any[]      Mixed array of option objects (picked from the
 *                              dropdown) and plain strings (free text). This is
 *                              the whole slicer state; keep it in page state.
 *  onChange         (v)=>void  Called with the next mixed array.
 *
 *  Data source — pick ONE:
 *  searchEndpoint   string     GET <endpoint>?q=<typed> server type-ahead.
 *  searchParams     object     Extra query params merged into that request.
 *  options          any[]      Static option list (no endpoint, filtered locally).
 *
 *  minChars         number     Chars before the endpoint is hit (default 2).
 *  debounceMs       number     Type-ahead debounce (default 250).
 *
 *  Shape of an option:
 *  getToken         (o)=>string  The FUZZY filter token a value contributes.
 *  getId            (o)=>string  The EXACT id a *picked* option contributes.
 *                                Omit when the entity has no id.
 *  renderLabel      (o)=>{code,rest}  Dropdown row: bold code + muted rest.
 *
 *  Exact-id vs fuzzy split (the Journals customer_id / customer model):
 *    a PICKED option yields getId(o) → send as the exact-id param;
 *    TYPED free text yields the string → send as the fuzzy text param.
 *  Use `splitSlicer(value, getId, getToken)` (exported below) or the
 *  `onSplitChange` callback; no page should re-derive this.
 *
 *  Selection / input:
 *  multiple         bool       Multi-select with chips (default true).
 *  freeSolo         bool       Typed text that matches nothing is still a
 *                              usable fuzzy filter (default true).
 *  limitTags        number     Chips shown before "+n" (default 2).
 *  disabled         bool
 *
 *  Item-field awareness (see AppSettings.itemId — Settings → Product Code Field):
 *  itemField        'alu'|'upc'|'description'
 *                              Render the chip/dropdown code from THAT DIM_ITEM
 *                              field instead of a hardcoded one.
 *  searchByItemField bool      Also send `field=<itemField>` so the backend
 *                              searches only the configured identifier
 *                              (default false = search all item fields).
 *
 *  Chrome:
 *  placeholder      string     Passed through tr() here — pass plain English.
 *  label            string     Optional floating label, also tr()'d.
 *  loading          bool       Force the in-input spinner (endpoint fetches
 *                              already drive it automatically).
 *  sx               object     Sizing only — colours come from --rt-* tokens.
 *
 * Colours: every colour is a `var(--rt-*)` design token, so dark mode and RTL
 * are automatic. Never add a hex literal to this file.
 */
import { useEffect, useMemo, useState } from 'react'
import { Autocomplete, TextField, Chip, Box, CircularProgress, InputAdornment } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { tr } from '../i18n'

export interface SlicerLabel { code: string; rest?: string }

/** The exact-id / fuzzy-text split every page needs. */
export interface SlicerSplit {
  picked: any[]      // option objects chosen from the dropdown
  typed:  string[]   // free text the user typed
  ids:    string[]   // getId(o) for each picked option (exact-match param)
  tokens: string[]   // getToken(o) for every value (fuzzy param)
}

export function splitSlicer(
  value: any[],
  getId?: (o: any) => string,
  getToken?: (o: any) => string,
): SlicerSplit {
  const picked = (value || []).filter(o => o && typeof o !== 'string')
  const typed  = (value || []).filter(o => typeof o === 'string').map(String).filter(Boolean)
  const ids    = getId ? picked.map(getId).filter(Boolean) : []
  const tokens = getToken
    ? (value || []).map(o => (typeof o === 'string' ? o : getToken(o))).filter(Boolean)
    : typed
  return { picked, typed, ids, tokens }
}

/** DIM_ITEM column behind each configured identifier, as returned by the
 *  item lookup endpoints (which echo the raw column names). */
export const ITEM_FIELD_KEYS: Record<string, string[]> = {
  alu:         ['ALU', 'alu'],
  upc:         ['UPC', 'upc'],
  description: ['DESCRIPTION1', 'description1'],
}

/** Read the configured identifier off an item option row, with a sane fallback. */
export function itemFieldValue(o: any, field?: string): string {
  const keys = ITEM_FIELD_KEYS[field || 'alu'] || ITEM_FIELD_KEYS.alu
  for (const k of keys) if (o?.[k]) return String(o[k])
  return String(o?.ALU ?? o?.alu ?? o?.UPC ?? o?.upc ?? '')
}

export interface DataSlicerProps {
  value: any[]
  onChange: (v: any[]) => void
  searchEndpoint?: string
  searchParams?: Record<string, any>
  options?: any[]
  minChars?: number
  debounceMs?: number
  getToken?: (o: any) => string
  getId?: (o: any) => string
  renderLabel?: (o: any) => SlicerLabel
  onSplitChange?: (s: SlicerSplit) => void
  multiple?: boolean
  freeSolo?: boolean
  limitTags?: number
  disabled?: boolean
  itemField?: string
  searchByItemField?: boolean
  placeholder?: string
  label?: string
  loading?: boolean
  sx?: any
}

export default function DataSlicer({
  value, onChange, searchEndpoint, searchParams, options: staticOptions,
  minChars = 2, debounceMs = 250,
  getToken, getId, renderLabel, onSplitChange,
  multiple = true, freeSolo = true, limitTags = 2, disabled,
  itemField, searchByItemField = false,
  placeholder, label, loading: loadingProp, sx,
}: DataSlicerProps) {
  const [input, setInput] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input), debounceMs)
    return () => clearTimeout(t)
  }, [input, debounceMs])

  // Default shapers: item-field aware when `itemField` is given, else the
  // option's own token/label (a plain string option is its own token).
  const token = useMemo(() => getToken ?? ((o: any) =>
    typeof o === 'string' ? o
      : (itemField ? itemFieldValue(o, itemField) : String(o?.name ?? o?.code ?? ''))
  ), [getToken, itemField])

  const labelOf = useMemo(() => renderLabel ?? ((o: any): SlicerLabel =>
    typeof o === 'string' ? { code: o }
      : { code: token(o), rest: String(o?.DESCRIPTION1 ?? o?.description1 ?? '') || undefined }
  ), [renderLabel, token])

  const extraParams = useMemo(() => ({
    ...(searchParams || {}),
    ...(searchByItemField && itemField ? { field: itemField } : {}),
  }), [searchParams, searchByItemField, itemField])

  const enabled = !!searchEndpoint && debounced.trim().length >= minChars
  const { data: fetched, isFetching } = useQuery({
    queryKey: ['data-slicer', searchEndpoint, debounced, extraParams],
    queryFn: () => axios.get(searchEndpoint as string,
      { params: { q: debounced.trim(), ...extraParams } }).then(r => r.data as any[]),
    enabled,
    staleTime: 30_000,
  })

  const opts: any[] = searchEndpoint ? ((fetched as any[]) ?? []) : (staticOptions ?? [])
  const busy = !!loadingProp || (enabled && isFetching)

  const emit = (v: any) => {
    const next = multiple ? (v as any[]) : (v == null ? [] : [v])
    onChange(next)
    onSplitChange?.(splitSlicer(next, getId, token))
  }

  const ph = placeholder ? tr(placeholder) : undefined
  const lb = label ? tr(label) : undefined

  return (
    <Autocomplete
      multiple={multiple as any}
      freeSolo={freeSolo as any}
      size="small" sx={sx} limitTags={limitTags} disabled={disabled}
      options={opts}
      value={multiple ? value : ((value?.[0] ?? null) as any)}
      onInputChange={(_, v) => setInput(v)}
      onChange={(_, v) => emit(v)}
      // Server-side search already filtered; static lists use MUI's matcher.
      filterOptions={searchEndpoint ? (x => x) : undefined}
      getOptionLabel={o => (typeof o === 'string' ? o : token(o))}
      isOptionEqualToValue={(a, b) => token(a) === token(b)}
      renderOption={(props, o) => {
        const l = labelOf(o)
        const { key, ...liProps } = props as any
        return (
          <Box component="li" {...liProps} key={key ?? token(o)}
            sx={{ py: '3px !important', px: '10px !important',
                  minHeight: 'auto !important', display: 'block !important' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--rt-text)' }}>{l.code}</span>
            {l.rest && (
              <span style={{ fontSize: 11.5, color: 'var(--rt-text-2)', marginInlineStart: 6 }}>
                | {l.rest}
              </span>
            )}
          </Box>
        )
      }}
      ListboxProps={{ sx: { py: 0.5, '& .MuiAutocomplete-option': { minHeight: 'auto' } } }}
      renderTags={(vals, getTagProps) =>
        vals.map((o, i) => {
          const t = typeof o === 'string' ? o : token(o)
          const { key, ...tagProps } = getTagProps({ index: i }) as any
          return <Chip key={key} size="small" label={t} {...tagProps} sx={{ height: 22, fontSize: 11 }} />
        })
      }
      renderInput={p => (
        <TextField {...p} label={lb} placeholder={ph} size="small"
          InputProps={{
            ...p.InputProps,
            // The busy indicator lives INSIDE the field — never as a stray
            // spinner floating next to the control.
            endAdornment: (
              <>
                {busy && (
                  <InputAdornment position="end" sx={{ mr: 0.5 }}>
                    <CircularProgress size={14} thickness={5}
                      sx={{ color: 'var(--rt-text-2)' }} />
                  </InputAdornment>
                )}
                {p.InputProps.endAdornment}
              </>
            ),
          }} />
      )}
    />
  )
}
