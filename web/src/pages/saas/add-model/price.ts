// Shared price label for catalog rows: free, sub-cent, or the raw number.
export function formatCatalogPrice(val: number, freeLabel: string) {
  if (val === 0) return freeLabel
  if (val < 0.0001) return `<$0.0001`
  const rounded = Number(val.toPrecision(4))
  return `$${rounded}`
}
