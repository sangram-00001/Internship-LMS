import { describe, expect, it } from 'vitest';
import { csvCell, csvRows } from '../src/lib/csv.js';
describe('CSV exports', () => {
  it.each(['=1+1', '+cmd', '-cmd', '@SUM(A1)', '\t=1+1', '\r\n+cmd'])('neutralizes spreadsheet formula input', input => {
    expect(csvCell(input)).toBe(`"'${input}"`);
  });
  it('escapes quotes, commas and line breaks without changing ordinary text', () => {
    expect(csvCell('A,"B"\nC')).toBe('"A,""B""\nC"');
    expect(csvRows([['Name', 'Amount'], ['Student', 100]])).toBe('\uFEFF"Name","Amount"\r\n"Student","100"');
  });
});
