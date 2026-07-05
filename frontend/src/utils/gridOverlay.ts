/**
 * Branded AG Grid "no rows" overlay.
 *
 * Replaces the bare default "No Rows To Show" with a subtle, on-brand empty
 * state (muted slate text + a simple glyph). Call noRowsOverlay() at render
 * time so the translation reflects the current language when it switches.
 */
import { tr } from '../i18n'

export function noRowsOverlay(): string {
  return (
    '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;' +
    'color:#94a3b8;font-family:inherit;padding:24px">' +
    '<div style="font-size:28px;opacity:.5">&#9638;</div>' +
    '<div style="font-weight:600">' + tr('No data to display') + '</div>' +
    '</div>'
  )
}
