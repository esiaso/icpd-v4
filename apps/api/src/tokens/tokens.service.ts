import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { dateOnly, isExpired, parseDateOnly } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';
import { BadRequest, NotFound } from '../common/errors';
import { randomDigits } from '../common/crypto';
import { AuditService } from '../audit/audit.service';
import { renderPdf, qrPng, BRAND } from '../common/pdf';

export const BATCH_SIZE = 30;

export interface TokenFilter {
  batch?: string;
  sessionNo?: number;
  status?: 'claimed' | 'unclaimed' | 'expired';
  search?: string;
}

/** Computed token status: expired when expiryDate < today (Nairobi), else stored status. */
export function tokenStatus(t: { status: string; expiryDate: Date }): 'claimed' | 'unclaimed' | 'expired' {
  if (t.status === 'claimed') return 'claimed';
  return isExpired(t.expiryDate) ? 'expired' : 'unclaimed';
}

export function claimUrl(activityId: bigint | string) {
  return `${config.appUrl}/token/${activityId}/claim`;
}

@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * Generate `count` tokens for one session (spec 5.5), split into batches of 30.
   * Batch id and token = activityId + 6 CSPRNG digits; uniqueness by DB index + retry (defect #7).
   */
  async generate(activityId: bigint, input: { count: number; sessionNo: number; validFrom: string; expiryDate: string }, actorId: bigint | null) {
    const activity = await this.prisma.activity.findFirst({ where: { id: activityId, deletedAt: null } });
    if (!activity) throw NotFound('Activity');
    if (input.sessionNo > Math.max(1, activity.numSessions)) throw BadRequest(`This activity has ${activity.numSessions} session(s).`);
    if (input.expiryDate < input.validFrom) throw BadRequest('The expiry date must be on or after the start date.');

    const prefix = activityId.toString();
    const validFrom = parseDateOnly(input.validFrom);
    const expiryDate = parseDateOnly(input.expiryDate);
    const batches: { batch: string; size: number }[] = [];
    const usedBatches = new Set((await this.prisma.activityToken.findMany({ where: { activityId }, distinct: ['batch'], select: { batch: true } })).map((b) => b.batch));
    for (let remaining = input.count; remaining > 0; remaining -= BATCH_SIZE) {
      let batch: string;
      do batch = prefix + randomDigits(6);
      while (usedBatches.has(batch));
      usedBatches.add(batch);
      batches.push({ batch, size: Math.min(BATCH_SIZE, remaining) });
    }

    let created = 0;
    for (const b of batches) {
      let need = b.size;
      for (let attempt = 0; need > 0 && attempt < 20; attempt++) {
        const tokens = new Set<string>();
        while (tokens.size < need) tokens.add(prefix + randomDigits(6));
        const res = await this.prisma.activityToken.createMany({
          data: [...tokens].map((token) => ({ token, activityId, sessionNo: input.sessionNo, batch: b.batch, validFrom, expiryDate, status: 'unclaimed' as const, createdBy: actorId })),
          skipDuplicates: true,
        });
        need -= res.count;
        created += res.count;
      }
      if (need > 0) throw BadRequest('Could not generate enough unique tokens; try a smaller number.');
    }
    await this.audit.log({ actorId, logName: 'tokens', event: 'generated', subjectType: 'activity', subjectId: activityId, properties: { ...input, batches: batches.map((b) => b.batch) } });
    return { created, batches: batches.map((b) => b.batch) };
  }

  where(activityId: bigint, f: TokenFilter): Prisma.ActivityTokenWhereInput {
    const where: Prisma.ActivityTokenWhereInput = { activityId, deletedAt: null };
    if (f.batch) where.batch = f.batch;
    if (f.sessionNo) where.sessionNo = Number(f.sessionNo);
    if (f.search) where.token = { contains: f.search.replace(/\s+/g, '') };
    const today = parseDateOnly(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date()));
    if (f.status === 'claimed') where.status = 'claimed';
    if (f.status === 'unclaimed') Object.assign(where, { status: 'unclaimed', expiryDate: { gte: today } });
    if (f.status === 'expired') Object.assign(where, { status: 'unclaimed', expiryDate: { lt: today } });
    return where;
  }

  async counts(activityId: bigint) {
    const today = parseDateOnly(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date()));
    const [total, claimed, expired, batches] = await Promise.all([
      this.prisma.activityToken.count({ where: { activityId, deletedAt: null } }),
      this.prisma.activityToken.count({ where: { activityId, deletedAt: null, status: 'claimed' } }),
      this.prisma.activityToken.count({ where: { activityId, deletedAt: null, status: 'unclaimed', expiryDate: { lt: today } } }),
      this.prisma.activityToken.groupBy({
        by: ['batch', 'sessionNo'],
        where: { activityId, deletedAt: null },
        _count: true,
        _min: { validFrom: true },
        _max: { expiryDate: true },
        orderBy: { batch: 'asc' },
      }),
    ]);
    return {
      total,
      claimed,
      unclaimed: total - claimed - expired,
      expired,
      batches: batches.map((b) => ({ batch: b.batch, sessionNo: b.sessionNo, count: b._count, validFrom: b._min.validFrom, expiryDate: b._max.expiryDate })),
    };
  }

  async updateOne(activityId: bigint, tokenId: bigint, input: { validFrom: string; expiryDate: string; issued?: boolean }, actorId: bigint) {
    const t = await this.prisma.activityToken.findFirst({ where: { id: tokenId, activityId, deletedAt: null } });
    if (!t) throw NotFound('Token');
    if (t.status === 'claimed') throw BadRequest('Claimed tokens cannot be edited.');
    await this.prisma.activityToken.update({
      where: { id: tokenId },
      data: { validFrom: parseDateOnly(input.validFrom), expiryDate: parseDateOnly(input.expiryDate), issued: input.issued ?? t.issued, updatedBy: actorId },
    });
    await this.audit.log({ actorId, logName: 'tokens', event: 'updated', subjectType: 'token', subjectId: tokenId, properties: input });
  }

  /** Bulk-edit validity by batch or by session; claimed tokens are left untouched. */
  async bulkUpdate(activityId: bigint, scope: { batch?: string; sessionNo?: number }, input: { validFrom: string; expiryDate: string }, actorId: bigint) {
    if (!scope.batch && !scope.sessionNo) throw BadRequest('Choose a batch or a session.');
    const r = await this.prisma.activityToken.updateMany({
      where: { activityId, deletedAt: null, status: 'unclaimed', ...(scope.batch ? { batch: scope.batch } : { sessionNo: Number(scope.sessionNo) }) },
      data: { validFrom: parseDateOnly(input.validFrom), expiryDate: parseDateOnly(input.expiryDate), updatedBy: actorId },
    });
    await this.audit.log({ actorId, logName: 'tokens', event: 'bulk-updated', subjectType: 'activity', subjectId: activityId, properties: { ...scope, ...input, count: r.count } });
    return { updated: r.count };
  }

  /** Delete by token, batch or session. Claimed tokens are kept (they back a diary entry). */
  async remove(activityId: bigint, scope: { tokenId?: bigint; batch?: string; sessionNo?: number }, actorId: bigint) {
    if (!scope.tokenId && !scope.batch && !scope.sessionNo) throw BadRequest('Choose a token, batch or session.');
    const where: Prisma.ActivityTokenWhereInput = { activityId, deletedAt: null, status: 'unclaimed' };
    if (scope.tokenId) where.id = scope.tokenId;
    else if (scope.batch) where.batch = scope.batch;
    else where.sessionNo = Number(scope.sessionNo);
    const r = await this.prisma.activityToken.updateMany({ where, data: { deletedAt: new Date(), deletedBy: actorId } });
    if (scope.tokenId && !r.count) throw BadRequest('Claimed tokens cannot be deleted.');
    await this.audit.log({ actorId, logName: 'tokens', event: 'deleted', subjectType: 'activity', subjectId: activityId, properties: { ...scope, count: r.count } });
    return { deleted: r.count };
  }

  private async forDownload(activityId: bigint, f: TokenFilter) {
    const a = await this.prisma.activity.findFirstOrThrow({ where: { id: activityId }, include: { provider: { select: { name: true } } } });
    const tokens = await this.prisma.activityToken.findMany({ where: this.where(activityId, { ...f, status: f.status ?? 'unclaimed' }), orderBy: [{ sessionNo: 'asc' }, { batch: 'asc' }, { token: 'asc' }] });
    return { a, tokens };
  }

  /** Printable token cards (10 per A4 page) with a QR code to /token/:activityId/claim. */
  async pdf(activityId: bigint, f: TokenFilter) {
    const { a, tokens } = await this.forDownload(activityId, f);
    const qr = await qrPng(claimUrl(activityId), 160);
    return renderPdf((doc) => {
      const cols = 2;
      const rows = 5;
      const m = 30;
      const w = (doc.page.width - m * 2) / cols;
      const h = (doc.page.height - m * 2) / rows;
      if (!tokens.length) doc.text('No tokens match this selection.');
      tokens.forEach((t, i) => {
        const idx = i % (cols * rows);
        if (i > 0 && idx === 0) doc.addPage();
        const x = m + (idx % cols) * w;
        const y = m + Math.floor(idx / cols) * h;
        doc.save().roundedRect(x + 4, y + 4, w - 8, h - 8, 6).dash(3, { space: 3 }).strokeColor('#999').stroke().restore();
        doc.image(qr, x + w - 92, y + 16, { width: 76 });
        doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(10).text('ICPD CPD TOKEN', x + 16, y + 16, { width: w - 120 });
        doc.fillColor('#000').font('Helvetica').fontSize(8).text(a.name, x + 16, y + 30, { width: w - 120, height: 30, ellipsis: true });
        doc.fontSize(7).fillColor('#555').text(a.provider.name, x + 16, y + 56, { width: w - 120, ellipsis: true });
        doc.fillColor('#000').font('Courier-Bold').fontSize(18).text(t.token, x + 16, y + 74, { width: w - 32 });
        doc.font('Helvetica').fontSize(7).fillColor('#333')
          .text(`Session ${t.sessionNo} · Batch ${t.batch}`, x + 16, y + 100)
          .text(`Valid ${dateOnly(t.validFrom)} to ${dateOnly(t.expiryDate)}`, x + 16, y + 110)
          .text(`Scan the QR code or visit ${claimUrl(activityId)}`, x + 16, y + 122, { width: w - 32 });
      });
    }, { margin: 0 });
  }

  async xlsx(activityId: bigint, f: TokenFilter) {
    const { a, tokens } = await this.forDownload(activityId, f);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tokens');
    ws.addRow([a.name]).font = { bold: true };
    ws.addRow([`Claim at ${claimUrl(activityId)}`]);
    ws.addRow([]);
    ws.addRow(['Token', 'Session', 'Batch', 'Valid from', 'Expires', 'Status']).font = { bold: true };
    for (const t of tokens) ws.addRow([t.token, t.sessionNo, t.batch, dateOnly(t.validFrom), dateOnly(t.expiryDate), tokenStatus(t)]);
    ws.columns.forEach((c) => (c.width = 18));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
