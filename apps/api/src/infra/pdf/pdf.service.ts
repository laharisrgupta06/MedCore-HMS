import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

/** Approved design tokens (DEC-033), used in print: sage for structure, tomato only for flags. */
export const PDF_COLORS = {
  sage: '#52714D',
  tomato: '#C8432B',
  ink: '#1E2420',
  muted: '#5F665F',
  rule: '#D8D3C6',
} as const;

export interface Letterhead {
  name: string;
  addressLines: string[];
  phone: string;
  email: string;
  licenseNumber: string;
}

export interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

type Doc = PDFKit.PDFDocument;

/**
 * Builds PDFs with PDFKit (DEC-040 D1): pure JavaScript, no browser. The standard Helvetica
 * family is used, so no font files are shipped. Output is A4 with page numbers on every page.
 */
@Injectable()
export class PdfService {
  async render(title: string, build: (doc: Doc) => void | Promise<void>): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      bufferPages: true,
      info: { Title: title, Producer: 'MedCore HMS' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
    });
    doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.ink);
    await build(doc);
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(PDF_COLORS.muted)
        .text(`${title} · page ${i + 1} of ${range.count}`, 48, doc.page.height - 32, {
          width: doc.page.width - 96,
          align: 'center',
          lineBreak: false,
        });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
    await done;
    return Buffer.concat(chunks);
  }

  /** Hospital letterhead (RX-008): name, address, contacts and licence, then a sage rule. */
  letterhead(doc: Doc, h: Letterhead): void {
    const x = doc.page.margins.left;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(PDF_COLORS.sage)
      .text(h.name, x, doc.page.margins.top, { width: w });
    doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted);
    for (const line of h.addressLines) doc.text(line, { width: w });
    doc.text(`${h.phone} · ${h.email} · Licence ${h.licenseNumber}`, { width: w });
    doc.moveDown(0.5);
    const y = doc.y;
    doc
      .moveTo(x, y)
      .lineTo(x + w, y)
      .lineWidth(1.5)
      .strokeColor(PDF_COLORS.sage)
      .stroke();
    doc.moveDown(0.8);
    doc.fillColor(PDF_COLORS.ink);
  }

  /** Label: value pairs in two columns. */
  facts(doc: Doc, pairs: [string, string][]): void {
    const x = doc.page.margins.left;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const col = w / 2;
    for (let i = 0; i < pairs.length; i += 2) {
      const y = doc.y;
      let next = y;
      for (const [j, pair] of pairs.slice(i, i + 2).entries()) {
        const cx = x + j * col;
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(PDF_COLORS.muted)
          .text(pair[0].toUpperCase(), cx, y, { width: col - 12 });
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(PDF_COLORS.ink)
          .text(pair[1], cx, doc.y, { width: col - 12 });
        next = Math.max(next, doc.y);
      }
      doc.x = x;
      doc.y = next + 6;
    }
  }

  /**
   * A table that breaks across pages and repeats its header. `cellColor` lets a caller mark a cell
   * (out-of-range lab values in tomato); the text itself must also carry the meaning for print.
   */
  table(
    doc: Doc,
    columns: Column[],
    rows: string[][],
    cellColor?: (row: number, col: number) => string | undefined,
  ): void {
    const x0 = doc.page.margins.left;
    const pad = 4;
    const header = () => {
      let x = x0;
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_COLORS.muted);
      for (const c of columns) {
        doc.text(c.header.toUpperCase(), x + pad, y, {
          width: c.width - 2 * pad,
          align: c.align ?? 'left',
        });
        x += c.width;
      }
      doc.y = y + 14;
      const total = columns.reduce((s, c) => s + c.width, 0);
      doc
        .moveTo(x0, doc.y)
        .lineTo(x0 + total, doc.y)
        .lineWidth(0.75)
        .strokeColor(PDF_COLORS.rule)
        .stroke();
      doc.y += 4;
    };
    header();
    doc.font('Helvetica').fontSize(9.5);
    rows.forEach((row, ri) => {
      const h =
        Math.max(
          ...row.map((cell, ci) =>
            doc.heightOfString(cell || ' ', { width: columns.at(ci)!.width - 2 * pad }),
          ),
        ) + 8;
      if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        header();
        doc.font('Helvetica').fontSize(9.5);
      }
      const y = doc.y;
      let x = x0;
      row.forEach((cell, ci) => {
        const c = columns.at(ci)!;
        const color = cellColor?.(ri, ci);
        doc
          .font(color ? 'Helvetica-Bold' : 'Helvetica')
          .fillColor(color ?? PDF_COLORS.ink)
          .text(cell, x + pad, y + 4, { width: c.width - 2 * pad, align: c.align ?? 'left' });
        x += c.width;
      });
      doc.y = y + h;
      const total = columns.reduce((s, c) => s + c.width, 0);
      doc
        .moveTo(x0, doc.y)
        .lineTo(x0 + total, doc.y)
        .lineWidth(0.5)
        .strokeColor(PDF_COLORS.rule)
        .stroke();
    });
    doc.x = x0;
    doc.moveDown(0.6);
    doc.font('Helvetica').fillColor(PDF_COLORS.ink);
  }
}
