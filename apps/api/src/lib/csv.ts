export function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function csvRows(rows: unknown[][]) { return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'); }
