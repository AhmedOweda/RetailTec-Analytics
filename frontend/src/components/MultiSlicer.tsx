/**
 * MultiSlicer — a multi-value, server-searched slicer with a rich, compact
 * dropdown (code | description style) and small elegant font so more rows are
 * visible. Supports free text: type and press Enter to add a text token; pick
 * suggestions; remove chips. Chips show a short token; the dropdown shows the
 * full label. Value is a mixed array of option objects and/or strings.
 */
import { Autocomplete, TextField, Chip, Box } from '@mui/material'

export interface SlicerLabel { code: string; rest?: string }

export default function MultiSlicer({
  value, onChange, options, getToken, renderLabel, onInput, placeholder, sx,
}: {
  value: any[]
  onChange: (v: any[]) => void
  options: any[]
  getToken: (o: any) => string
  renderLabel: (o: any) => SlicerLabel
  onInput: (q: string) => void
  placeholder: string
  sx?: any
}) {
  return (
    <Autocomplete
      multiple freeSolo size="small" sx={sx} limitTags={2}
      options={options} value={value}
      onInputChange={(_, v) => onInput(v)} onChange={(_, v) => onChange(v)}
      filterOptions={x => x}
      getOptionLabel={o => (typeof o === 'string' ? o : getToken(o))}
      isOptionEqualToValue={(a, b) => getToken(a) === getToken(b)}
      renderOption={(props, o) => {
        const l = typeof o === 'string' ? { code: o } as SlicerLabel : renderLabel(o)
        return (
          <Box component="li" {...props} key={getToken(o)}
            sx={{ py: '3px !important', px: '10px !important', minHeight: 'auto !important', display: 'block !important' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--rt-text)' }}>{l.code}</span>
            {l.rest && <span style={{ fontSize: 11.5, color: '#94a3b8', marginInlineStart: 6 }}>| {l.rest}</span>}
          </Box>
        )
      }}
      ListboxProps={{ sx: { py: 0.5, '& .MuiAutocomplete-option': { minHeight: 'auto' } } }}
      renderTags={(vals, getTagProps) =>
        vals.map((o, i) => {
          const t = typeof o === 'string' ? o : getToken(o)
          const { key, ...tagProps } = getTagProps({ index: i }) as any
          return <Chip key={key} size="small" label={t} {...tagProps} sx={{ height: 22, fontSize: 11 }} />
        })
      }
      renderInput={p => <TextField {...p} placeholder={placeholder} size="small" />}
    />
  )
}
