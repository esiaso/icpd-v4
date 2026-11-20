import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export type Doc = PDFKit.PDFDocument;

/** Build a PDF in memory. */
export function renderPdf(build: (doc: Doc) => Promise<void> | void, opts: PDFKit.PDFDocumentOptions = {}): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, ...opts });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      await build(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export async function qrPng(text: string, size = 220): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: 'png', width: size, margin: 1, errorCorrectionLevel: 'M' });
}

export const BRAND = '#0f5132';

export function header(doc: Doc, title: string, subtitle?: string) {
  doc.fillColor(BRAND).fontSize(18).font('Helvetica-Bold').text('ICPD', { continued: true }).fillColor('#333').font('Helvetica').fontSize(12).text('  Continuing Professional Development');
  doc.moveDown(0.5).fillColor('#000').font('Helvetica-Bold').fontSize(15).text(title);
  if (subtitle) doc.font('Helvetica').fontSize(10).fillColor('#555').text(subtitle);
  doc.fillColor('#000').moveDown(0.8);
}

/** Simple table with wrapping cells and page breaks. */
export function table(doc: Doc, cols: { label: string; width: number; align?: 'left' | 'right' }[], rows: string[][]) {
  const x0 = doc.page.margins.left;
  const drawRow = (cells: string[], bold = false) => {
    const heights = cells.map((c, i) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).heightOfString(c ?? '', { width: cols[i].width - 6 }));
    const h = Math.max(...heights, 12) + 6;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    let x = x0;
    cells.forEach((c, i) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(c ?? '', x + 3, y + 3, { width: cols[i].width - 6, align: cols[i].align ?? 'left' });
      x += cols[i].width;
    });
    doc.moveTo(x0, y + h).lineTo(x, y + h).strokeColor('#ddd').stroke();
    doc.x = x0;
    doc.y = y + h;
  };
  drawRow(cols.map((c) => c.label), true);
  rows.forEach((r) => drawRow(r));
  doc.moveDown(0.5);
}
