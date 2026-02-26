/**
 * Parse a single input line into { barcodeValue, displayText }.
 *
 * Format:  "value\tcaption"
 *   - If a tab character is present, the part before the first tab is the
 *     barcode content and the part after is the display text shown below the bars.
 *   - If no tab is present, the whole line is the barcode content and the
 *     display text falls back to whatever the barcode library renders by default.
 */
export const parseLine = (
  line: string,
): { barcodeValue: string; displayText: string | undefined } => {
  const tabIndex = line.indexOf('\t')
  if (tabIndex !== -1) {
    const barcodeValue = line.slice(0, tabIndex).trim()
    const caption = line.slice(tabIndex + 1).trim()
    return {
      barcodeValue,
      // Treat an empty caption the same as no caption (fallback to default).
      displayText: caption !== '' ? caption : undefined,
    }
  }
  return { barcodeValue: line.trim(), displayText: undefined }
}
