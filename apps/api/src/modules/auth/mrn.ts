/**
 * Medical record number, unique per hospital: MRN-{year}-{6-digit sequence}. The sequence is
 * the hospital's patient count plus one; a concurrent duplicate is caught by the database's
 * unique (hospitalId, mrn) constraint and the caller retries with the next number.
 */
export function formatMrn(year: number, sequence: number): string {
  return `MRN-${year}-${String(sequence).padStart(6, '0')}`;
}
