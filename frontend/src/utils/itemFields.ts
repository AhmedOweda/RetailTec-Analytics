/**
 * Optional item-master fields — configurable extra columns for every AG Grid
 * that lists items. Keys match DIM_ITEM columns (whitelisted server-side);
 * pages append `item_fields=<csv>` to item queries and extra colDefs.
 */
import type { ColDef } from 'ag-grid-community'
import { moneyExact } from './formatters'

export interface ItemFieldDef { key: string; label: string; numeric?: boolean }

export const ITEM_FIELDS: ItemFieldDef[] = [
  { key: 'DESCRIPTION2',     label: 'Description 2' },
  { key: 'DESCRIPTION3',     label: 'Description 3' },
  { key: 'DESCRIPTION4',     label: 'Description 4' },
  { key: 'LONG_DESCRIPTION', label: 'Long Description' },
  { key: 'ATTRIBUTE',        label: 'Attribute' },
  { key: 'ITEM_SIZE',        label: 'Size' },
  ...Array.from({ length: 10 }, (_, i) =>
    ({ key: `TEXT${i + 1}`, label: `Text ${i + 1}` })),
  ...Array.from({ length: 5 }, (_, i) =>
    ({ key: `UDF${i + 1}_STRING`, label: `UDF ${i + 1}` })),
  { key: 'PRICE_LVL1', label: 'Price Level 1', numeric: true },
  { key: 'PRICE_LVL2', label: 'Price Level 2', numeric: true },
  { key: 'PRICE_LVL3', label: 'Price Level 3', numeric: true },
]

const BY_KEY = Object.fromEntries(ITEM_FIELDS.map(f => [f.key, f]))

export function itemFieldLabel(key: string): string {
  return BY_KEY[key]?.label ?? key
}

/** `&item_fields=A,B` query-string fragment ('' when nothing selected) */
export function itemFieldsQS(selected: string[]): string {
  return selected.length ? `&item_fields=${encodeURIComponent(selected.join(','))}` : ''
}

/** Extra AG Grid columns for the selected fields */
export function itemFieldCols(selected: string[]): ColDef[] {
  return selected.map(k => {
    const def = BY_KEY[k]
    if (!def) return null
    return def.numeric
      ? { field: k, headerName: def.label, width: 120, type: 'numericColumn',
          valueFormatter: (p: any) => p.value == null ? '' : moneyExact(p.value, 2) }
      : { field: k, headerName: def.label, width: 140 }
  }).filter(Boolean) as ColDef[]
}
