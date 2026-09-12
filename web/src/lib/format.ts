/**
 * Shared display formatting for money values.
 *
 * Product rule: prices, spend and model value are shown with two decimals. Two cases
 * need care:
 * - a missing value renders as an em dash instead of a fake `$0.00`;
 * - a non-zero value that rounds to `0.00` renders as `<$0.01`, so cheap traffic is not
 *   reported as free.
 *
 * Use `formatPriceInput` from `pages/saas/serviceUtils.ts` for editable price fields:
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
