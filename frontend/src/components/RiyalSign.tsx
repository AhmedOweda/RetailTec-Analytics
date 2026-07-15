/**
 * RiyalSign - the Saudi Riyal symbol (U+20C1) drawn as an inline SVG.
 *
 * WHY: the Unicode glyph only renders where a font that ships it is available
 * (new OS fonts, or our embedded webfont). On machines/browsers without it the
 * character shows as a tofu box. This SVG is font-INDEPENDENT - it draws the
 * exact same shape everywhere, so money always renders correctly.
 *
 * Path extracted from the `riyal` webfont glyph (1000 UPM, adv 895), flipped
 * from font space (Y-up) to SVG space (Y-down). Uses currentColor so it inherits
 * the surrounding text colour, and sizes to the font size (em) to match text.
 */
import type { CSSProperties } from 'react'

interface Props {
  size?: string | number
  style?: CSSProperties
  title?: string
}

const RIYAL_PATH =
  'M557 114C541 79 530 41 526 1L864 73C880 108 891 146 895 186L557 114ZM864 287C880 322 891 360 ' +
  '895 400L632 344V452L864 501C880 537 891 575 895 615L632 559V946C591 924 555 894 526 858V537L421 ' +
  '515V999C381 976 345 946 316 910V491L80 441C64 406 53 368 49 328L315 385V249L30 189C14 153 3 115 ' +
  '-1 75L297 139C322 144 343 158 357 178L412 259C418 268 421 278 421 289V408L526 430V215L864 287Z'

export default function RiyalSign({ size = '0.92em', style, title = 'SAR' }: Props) {
  return (
    <svg
      viewBox="0 0 895 1000"
      role="img"
      aria-label={title}
      style={{
        height: size,
        width: 'auto',
        display: 'inline-block',
        verticalAlign: '-0.11em',
        fill: 'currentColor',
        ...style,
      }}
    >
      <g transform="translate(0,1000) scale(1,-1)">
        <path d={RIYAL_PATH} />
      </g>
    </svg>
  )
}

/**
 * CurrencyMark - renders the RiyalSign SVG for SAR, or the plain text symbol for
 * any other currency (QAR, etc. render fine as text). Drop-in for any place that
 * currently prints `{currency.symbol}` on screen.
 */
export function CurrencyMark(
  { code, symbol, size, style }:
  { code?: string; symbol?: string; size?: string | number; style?: CSSProperties },
) {
  if (code === 'SAR') return <RiyalSign size={size} style={style} />
  return <>{symbol ?? ''}</>
}

/**
 * MoneyText - renders a preformatted money STRING, swapping every embedded
 * U+20C1 (the Saudi Riyal char produced by the money() formatters) for the
 * font-independent SVG. Drop-in for `{value}` in any money display so cards,
 * subtitles etc. never show a tofu box. Non-SAR strings pass straight through.
 */
export function MoneyText({ text, size }: { text?: string | number; size?: string | number }) {
  const RIYAL = String.fromCharCode(0x20C1)  // U+20C1 SAUDI RIYAL SIGN
  const s = text == null ? '' : String(text)
  if (s.indexOf(RIYAL) === -1) return <>{s}</>
  const parts = s.split(RIYAL)
  const out: JSX.Element[] = []
  parts.forEach((p, i) => {
    if (i > 0) out.push(<RiyalSign key={`r${i}`} size={size} />)
    if (p) out.push(<span key={`t${i}`}>{p}</span>)
  })
  return <>{out}</>
}
