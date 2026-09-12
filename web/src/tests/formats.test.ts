import { describe, expect, it } from 'vitest'

import { formatMoney } from '../lib/format'
import { formatPriceInput } from '../pages/saas/serviceUtils'

describe('formatMoney', () => {
  it('renders two decimals for normal amounts', () => {
    expect(formatMoney(1.2)).toBe('$1.20')
    expect(formatMoney(0.14)).toBe('$0.14')
    expect(formatMoney(1234.567)).toBe('$1234.57')
    expect(formatMoney(12)).toBe('$12.00')
  })

  it('renders exact zero as $0.00', () => {
    expect(formatMoney(0)).toBe('$0.00')
  })

  it('renders tiny non-zero values as <$0.01 instead of a free-looking $0.00', () => {
    expect(formatMoney(0.004)).toBe('<$0.01')
    expect(formatMoney(0.000001)).toBe('<$0.01')
    expect(formatMoney(0.004999)).toBe('<$0.01')
  })

  it('rounds the $0.005 boundary up rather than down', () => {
    expect(formatMoney(0.005)).toBe('$0.01')
  })

  it('renders the em dash for null, undefined and NaN', () => {
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(undefined)).toBe('—')
    expect(formatMoney(Number.NaN)).toBe('—')
  })

  it('keeps the sign on negative values, including tiny ones', () => {
    expect(formatMoney(-2.5)).toBe('-$2.50')
    expect(formatMoney(-1234.567)).toBe('-$1234.57')
    expect(formatMoney(-0.004)).toBe('-<$0.01')
    expect(formatMoney(-0)).toBe('$0.00')
  })
})

describe('formatPriceInput', () => {
  it('keeps at most four decimals and strips trailing zeros', () => {
    expect(formatPriceInput(3.5999999999999996)).toBe('3.6')
    expect(formatPriceInput(0.0014)).toBe('0.0014')
    expect(formatPriceInput(1.23456)).toBe('1.2346')
    expect(formatPriceInput(2)).toBe('2')
    expect(formatPriceInput(0.5)).toBe('0.5')
    expect(formatPriceInput(-1.25)).toBe('-1.25')
  })

  it('collapses zeros and sub-precision values to "0"', () => {
    expect(formatPriceInput(0)).toBe('0')
    expect(formatPriceInput(0.00001)).toBe('0')
    expect(formatPriceInput('0.0000')).toBe('0')
  })

  it('never emits more than four decimal places', () => {
    expect(formatPriceInput(1 / 3)).toMatch(/^-?\d+(\.\d{1,4})?$/)
    expect(formatPriceInput(0.123456789)).toMatch(/^-?\d+(\.\d{1,4})?$/)
  })

  it('accepts strings and trims their trailing zeros', () => {
    expect(formatPriceInput('1.1000')).toBe('1.1')
    expect(formatPriceInput('0.00140')).toBe('0.0014')
  })

  it('passes through empty and non-numeric input unchanged', () => {
    expect(formatPriceInput('')).toBe('')
    expect(formatPriceInput(null)).toBe('')
    expect(formatPriceInput(undefined)).toBe('')
    expect(formatPriceInput('not-a-number')).toBe('not-a-number')
  })
})
