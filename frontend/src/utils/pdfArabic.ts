/**
 * pdfArabic — helpers to make jsPDF render Arabic correctly.
 *
 * jsPDF draws glyphs left-to-right using whatever font is set and does NO
 * Arabic shaping (letter joining) and NO bidi reordering. Built-in Helvetica
 * also has zero Arabic glyphs. So Arabic text comes out garbled.
 *
 * This module fixes that in three steps, applied ONLY when the UI language
 * is Arabic:
 *   1. registerArabicFont() embeds an Amiri TTF that has Arabic Presentation
 *      Forms-B + Latin + digits.
 *   2. shapeAr() reshapes Arabic into presentation forms (arabic-reshaper),
 *      then reorders the whole string into VISUAL order (bidi-js) so that when
 *      jsPDF paints it LTR it appears in correct RTL reading order — while any
 *      embedded Latin words / numbers stay in their correct place and direction.
 *
 * Everything is defensive: any failure returns the original text unchanged, and
 * for non-Arabic language / non-Arabic text shapeAr() is a pure pass-through, so
 * the English export path is byte-for-byte identical to before.
 */
import type jsPDF from 'jspdf'
import i18n from '../i18n'
// arabic-reshaper exposes { convertArabic, convertArabicBack }
import * as reshaper from 'arabic-reshaper'
// bidi-js default export is a factory returning the bidi object
import bidiFactory from 'bidi-js'
import { ARABIC_FONT_NAME, ARABIC_FONT_BASE64 } from './arabicFont'

export { ARABIC_FONT_NAME }

const bidi = bidiFactory()

// Any character in the Arabic block (incl. presentation forms) — used to skip
// pure-Latin/numeric cells so they are never touched.
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/

/** True when the active UI language is Arabic. */
export function isArabic(): boolean {
  return i18n.language === 'ar'
}

/**
 * True if ANY of the given parts contains an Arabic-block character. Used to
 * decide whether an export's CONTENT (headers + cell values) needs the browser
 * image path — regardless of the UI language, because data cells (customer /
 * supplier / vendor names) can be Arabic even in the English UI.
 */
export function hasArabic(parts: (string | number)[]): boolean {
  const re = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/
  return parts.some(p => re.test(String(p ?? '')))
}

/** Register the embedded Arabic (Amiri) font on a jsPDF doc. Call once per doc. */
export function registerArabicFont(doc: jsPDF): void {
  try {
    const file = ARABIC_FONT_NAME + '.ttf'
    doc.addFileToVFS(file, ARABIC_FONT_BASE64)
    doc.addFont(file, ARABIC_FONT_NAME, 'normal')
  } catch {
    /* never throw from export code */
  }
}

/**
 * Reshape + bidi-reorder a single line of text into the VISUAL order jsPDF needs.
 * Pass-through (returns input unchanged) when the language isn't Arabic or the
 * text contains no Arabic characters — so numbers, Latin names and the whole
 * English export path are untouched.
 */
export function shapeAr(text: string): string {
  if (text == null) return text
  const s = String(text)
  if (!isArabic() || !ARABIC_RE.test(s)) return s
  try {
    // 1. Join letters into their contextual presentation forms.
    const shaped = (reshaper as any).convertArabic(s) as string
    // 2. Reorder into VISUAL order using the Unicode bidi algorithm with an RTL
    //    base direction (the paragraph is Arabic). getReorderedString applies
    //    all reversal segments (and mirrored brackets) for us, producing the
    //    left-to-right visual string jsPDF paints correctly — Latin words and
    //    number runs keep their own correct order/direction.
    const embeddingLevels = bidi.getEmbeddingLevels(shaped, 'rtl')
    return bidi.getReorderedString(shaped, embeddingLevels)
  } catch {
    return s
  }
}
