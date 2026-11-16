import { PdfService } from './pdf.service';

describe('PdfService (DEC-040 D1, PDFKit)', () => {
  it('builds a multi-page A4 PDF with letterhead, table and page numbers', async () => {
    const pdf = new PdfService();
    const rows = Array.from({ length: 80 }, (_, i) => [
      `Row ${i + 1}`,
      'Paracetamol 500 mg',
      String(i),
    ]);
    const buf = await pdf.render('Test document', (doc) => {
      pdf.letterhead(doc, {
        name: 'City Hospital',
        addressLines: ['1 Main Road', 'Bengaluru 560001'],
        phone: '+914400000000',
        email: 'a@b.c',
        licenseNumber: 'L-1',
      });
      pdf.facts(doc, [
        ['Patient', 'Pat One'],
        ['MRN', 'MRN-1'],
      ]);
      pdf.table(
        doc,
        [
          { header: 'Name', width: 150 },
          { header: 'Medicine', width: 250 },
          { header: 'Qty', width: 99, align: 'right' },
        ],
        rows,
        (r, c) => (r === 3 && c === 2 ? '#C8432B' : undefined),
      );
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(2000);
    const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(1);
  });
});
