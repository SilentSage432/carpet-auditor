/** Converts circular cross-section measurement (inches) × rounds → calculated linear feet. */
export const CLF_FACTOR = 0.2625;

export const FRACTION_OPTIONS = [
  { label: '0"', value: 0 },
  { label: '1/8"', value: 0.125 },
  { label: '1/4"', value: 0.25 },
  { label: '3/8"', value: 0.375 },
  { label: '1/2"', value: 0.5 },
  { label: '5/8"', value: 0.625 },
  { label: '3/4"', value: 0.75 },
  { label: '7/8"', value: 0.875 },
] as const;

export function toTotalInches(wholeInches: number, fraction: number): number {
  return wholeInches + fraction;
}

export function calculateClf(totalInches: number, rounds: number): number {
  return totalInches * rounds * CLF_FACTOR;
}

export function formatClf(clf: number): string {
  return clf.toFixed(2);
}

export function formatMeasurementDisplay(wholeInches: number, fraction: number): string {
  const option = FRACTION_OPTIONS.find((f) => f.value === fraction);
  const fractionLabel = option?.label.replace('"', "") ?? String(fraction);
  if (fraction === 0) return `${wholeInches}"`;
  return `${wholeInches} ${fractionLabel}"`;
}

export function formatDecimalInches(totalInches: number): string {
  return `${totalInches.toFixed(2)}"`;
}

export function formatFormulaBreakdown(
  totalInches: number,
  rounds: number,
  clf: number
): string {
  return `${totalInches.toFixed(2)}" × ${rounds} rounds × ${CLF_FACTOR} = ${formatClf(clf)} CLF`;
}

export function calculateSquareFeet(widthFt: number, lengthFt: number): number {
  return widthFt * lengthFt;
}

export function calculateSquareYards(squareFeet: number): number {
  return squareFeet / 9;
}

export function formatSqYd(sqYd: number): string {
  return sqYd.toFixed(2);
}

/** Carton / unit goods: Total SqFt = cartons × coverage per box. */
export function calculateCartonSqFt(
  boxCount: number,
  sqFtPerBox: number
): number {
  return boxCount * sqFtPerBox;
}

export function formatSqFt(sqFt: number): string {
  return sqFt.toFixed(2);
}

export function formatCartonBreakdown(
  boxCount: number,
  sqFtPerBox: number,
  totalSqFt: number
): string {
  return `${boxCount} × ${formatSqFt(sqFtPerBox)} sq ft/box = ${formatSqFt(totalSqFt)} sq ft`;
}
