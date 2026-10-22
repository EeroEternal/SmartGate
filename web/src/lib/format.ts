/**
 * Shared display formatting for money values.
 *
 * Product rule: prices, spend and model value are shown with two decimals. Two cases
 * need care:
 * - a missing value renders as an em dash instead of a fake `$0.00`;
 * - a non-zero value that rounds to `0.00` renders as `<$0.01`, so cheap traffic is not
 *   reported as free.
 *
 * Use `formatPriceInput` for editable price fields:
 * those keep up to four decimals and drop trailing zeros.
 */
export function formatMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  const absolute = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (absolute === 0) return '$0.00'
  if (absolute < 0.005) return `${sign}<$0.01`
  return `${sign}$${absolute.toFixed(2)}`
}

export function formatPriceInput(value: number | string | null | undefined): string {
  if (value == null || value === '') return ''
  const num = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(num)) return String(value)
  const rounded = Math.round(num * 10000) / 10000
  if (Math.abs(rounded) < 0.00005) return '0'
  return rounded.toFixed(4).replace(/\.?0+$/, '')
}

export function formatMaskedKey(prefix: string | null | undefined): string {
  if (!prefix) return '—'
  return prefix.includes('...') ? prefix : `${prefix}...`
}

