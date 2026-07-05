/**
 * pdfImage — render an Arabic data table to PDF via the BROWSER, not jsPDF fonts.
 *
 * jsPDF cannot reliably render the Amiri Arabic presentation-form glyphs, so
 * Arabic tables come out corrupted even after correct reshape + bidi. The fix:
 * build the table as an off-screen HTML element (dir="rtl"), let the browser
 * shape Arabic natively (which it always does correctly), rasterise it with
 * html2canvas, and drop that image into the jsPDF document — paginated so long
 * tables span multiple pages.
 *
 * This path is used ONLY for Arabic exports. The English/Latin autoTable path is
 * left untouched.
 */
import type jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const ACCENT = '#7c3aed'
const HEADER_BAND = '#160b33'

/** Escape a cell value for safe HTML insertion. */
function esc(v: string | number): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** True if the string contains any Arabic-block character. */
const AR_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/

export interface ArabicTableOpts {
  title:     string
  subtitle?: string
  head:      string[]
  body:      (string | number)[][]
  filename:  string
  /**
   * Table direction. True (RTL) only when the UI language is Arabic; false
   * (LTR) when the UI is English but the data contains Arabic — so English
   * column order stays left-to-right while Arabic cell values still shape and
   * read right-to-left via per-cell bidi. Defaults to true for back-compat.
   */
  rtl?:      boolean
}

/**
 * Render an Arabic table to the given jsPDF doc as a browser-rasterised image,
 * paginate it across pages, and save it as `filename`.
 */
export async function arabicTableToPdf(doc: jsPDF, opts: ArabicTableOpts): Promise<void> {
  const { title, subtitle, head, body, filename } = opts
  const rtl = opts.rtl !== false   // default RTL for back-compat

  /* Header text-align follows the table direction so column headers sit on the
     leading edge; when LTR (English UI + Arabic data) headers align left. */
  const headAlign = rtl ? 'right' : 'left'

  /* ── Build the off-screen table markup ─────────────────────────── */
  const headHtml = head.map(h =>
    `<th style="background:${ACCENT};color:#fff;font-weight:700;font-size:18px;padding:10px 14px;text-align:${headAlign};border:1px solid #6d28d9;white-space:nowrap">${esc(h)}</th>`
  ).join('')

  const bodyHtml = body.map((row, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#f4f2ff'
    const cells = row.map(cell => {
      const s = String(cell ?? '')
      // Align to match the Arabic-ness of the cell; `unicode-bidi:plaintext`
      // makes each cell pick its own base direction, so Arabic values shape
      // and read right-to-left even inside an LTR (English) table.
      const isAr = AR_RE.test(s)
      const align = isAr ? 'right' : 'left'
      return `<td style="background:${bg};color:#1e293b;font-size:16px;padding:8px 14px;border:1px solid #e2e8f0;text-align:${align};unicode-bidi:plaintext;white-space:nowrap">${esc(s)}</td>`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('')

  const el = document.createElement('div')
  el.style.cssText = [
    'position:absolute', 'left:-10000px', 'top:0',
    'width:1600px', 'background:#ffffff', 'padding:24px',
    `direction:${rtl ? 'rtl' : 'ltr'}`,
    "font-family:'Cairo','Segoe UI','Tahoma','Arial',sans-serif",
    'box-sizing:border-box',
  ].join(';')

  const subHtml = subtitle
    ? `<div style="font-size:15px;color:#c4b5fd;margin-top:6px">${esc(subtitle)}</div>`
    : ''

  el.innerHTML = `
    <div style="background:${HEADER_BAND};border-radius:10px;padding:18px 22px;margin-bottom:18px">
      <div style="font-size:26px;font-weight:800;color:#ffffff">${esc(title)}</div>
      ${subHtml}
    </div>
    <table dir="${rtl ? 'rtl' : 'ltr'}" style="width:100%;border-collapse:collapse;table-layout:auto">
      <thead><tr>${headHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>`

  document.body.appendChild(el)

  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })

    /* ── Paginate by SLICING the canvas per page and embedding each slice as a
       compressed JPEG. The naive pattern (adding the full bitmap to every page
       with a shifted Y) duplicates the whole image N times and produced ~400 MB
       files that viewers then downsampled to a blurry mess. ── */
    const pageW   = doc.internal.pageSize.getWidth()
    const pageH   = doc.internal.pageSize.getHeight()
    const margin  = pageW * 0.03
    const imgW    = pageW - margin * 2
    const usableH = pageH - margin * 2
    // How many source-canvas pixels fit into one PDF page's usable height.
    const pxPerPage = Math.max(1, Math.floor((usableH * canvas.width) / imgW))

    let srcY  = 0
    let first = true
    while (srcY < canvas.height) {
      const sliceH = Math.min(pxPerPage, canvas.height - srcY)
      const slice  = document.createElement('canvas')
      slice.width  = canvas.width
      slice.height = sliceH
      const ctx = slice.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, slice.width, slice.height)
      ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH)
      const sliceData = slice.toDataURL('image/jpeg', 0.85)
      const sliceImgH = (sliceH * imgW) / canvas.width
      if (!first) doc.addPage()
      doc.addImage(sliceData, 'JPEG', margin, margin, imgW, sliceImgH)
      first = false
      srcY += sliceH
    }

    doc.save(filename)
  } finally {
    document.body.removeChild(el)
  }
}
