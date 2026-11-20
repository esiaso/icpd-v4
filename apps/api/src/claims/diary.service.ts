import { Injectable } from '@nestjs/common';
import { dateOnly, nairobiYear, performancePercent, round2 } from '@icpd/shared';
import { PrismaService, num } from '../common/prisma.service';
import { NotFound } from '../common/errors';
import { header, renderPdf, table, BRAND } from '../common/pdf';
import { ComplianceService } from '../compliance/compliance.service';

/** CPD diary, performance and printable documents (spec 5.7). */
@Injectable()
export class DiaryService {
  constructor(private readonly prisma: PrismaService, private readonly compliance: ComplianceService) {}

  async years(practitionerId: bigint): Promise<number[]> {
    const rows = await this.prisma.cpdClaim.findMany({ where: { practitionerId, deletedAt: null }, distinct: ['calYear'], select: { calYear: true }, orderBy: { calYear: 'desc' } });
    const ys = rows.map((r) => r.calYear);
    const now = nairobiYear();
    if (!ys.includes(now)) ys.unshift(now);
    return ys;
  }

  async points(practitionerId: bigint, year: number): Promise<number> {
    const r = await this.prisma.cpdClaim.aggregate({ where: { practitionerId, calYear: year, deletedAt: null }, _sum: { cpdPoints: true } });
    return num(r._sum.cpdPoints);
  }

  async diary(practitionerId: bigint, year: number, activityTypeId?: number) {
    const claims = await this.prisma.cpdClaim.findMany({
      where: {
        practitionerId,
        calYear: year,
        deletedAt: null,
        ...(activityTypeId ? { entries: { some: { activityTypeId } } } : {}),
      },
      include: {
        activity: { select: { id: true, name: true, releaseDate: true, expiryDate: true, provider: { select: { name: true } }, type: { select: { id: true, name: true } } } },
        nonTokenClaim: { select: { id: true, activityName: true, beginDate: true, endDate: true, place: true, activityType: { select: { id: true, name: true } } } },
        entries: { select: { id: true, kind: true, source: true, points: true, activityTypeId: true, awardedAt: true } },
      },
      orderBy: { claimedAt: 'desc' },
    });
    return claims.map((c) => ({
      id: c.id,
      method: c.method,
      tokenTrail: c.tokenTrail,
      cpdPoints: c.cpdPoints,
      calYear: c.calYear,
      claimedAt: c.claimedAt,
      activityId: c.activityId,
      name: c.activity?.name ?? c.nonTokenClaim?.activityName ?? c.apiActivityName ?? 'CPD activity',
      provider: c.activity?.provider.name ?? (c.nonTokenClaim ? 'Self-reported (approved)' : null),
      activityType: c.activity?.type ?? c.nonTokenClaim?.activityType ?? null,
      startDate: c.activity?.releaseDate ?? c.nonTokenClaim?.beginDate ?? null,
      endDate: c.activity?.expiryDate ?? c.nonTokenClaim?.endDate ?? null,
      entries: c.entries,
    }));
  }

  async portfolio(practitionerId: bigint, year: number) {
    const [points, years, diary, pending, compliance] = await Promise.all([
      this.points(practitionerId, year),
      this.years(practitionerId),
      this.diary(practitionerId, year),
      this.prisma.nonTokenClaim.findMany({
        where: { practitionerId, deletedAt: null, status: { in: ['Pending', 'Rejected', 'No'] } },
        include: { activityType: { select: { name: true } } },
        orderBy: { claimDate: 'desc' },
      }),
      this.compliance.evaluate(practitionerId, year),
    ]);
    const required = compliance.framework.totalRequiredPoints;
    const rejectionReasons = await this.prisma.comment.findMany({
      where: { type: 'Non-Token Claim', itemId: { in: pending.filter((p) => p.status === 'Rejected').map((p) => p.id) } },
      orderBy: { date: 'desc' },
    });
    return {
      year,
      years,
      points,
      required,
      performance: performancePercent(points, required),
      countablePoints: compliance.evaluation.countablePoints,
      compliant: compliance.evaluation.compliant,
      exempted: !!compliance.exemption,
      diary,
      pendingClaims: pending.map((p) => ({ ...p, reason: rejectionReasons.find((r) => r.itemId === p.id)?.comment ?? null })),
    };
  }

  private async practitionerHeader(practitionerId: bigint) {
    const p = await this.prisma.practitioner.findFirst({
      where: { id: practitionerId },
      include: { specialization: { select: { name: true } }, category: { select: { name: true } } },
    });
    if (!p) throw NotFound('Practitioner');
    return p;
  }

  private async groupedSection(doc: PDFKit.PDFDocument, practitionerId: bigint, year: number) {
    const s = await this.compliance.summary(practitionerId, year);
    doc.font('Helvetica-Bold').fontSize(11).text('Points by activity type');
    doc.moveDown(0.3);
    table(
      doc,
      [
        { label: 'Activity type', width: 230 },
        { label: 'Claims', width: 60, align: 'right' },
        { label: 'Points', width: 70, align: 'right' },
        { label: 'Countable', width: 75, align: 'right' },
        { label: 'Share', width: 60, align: 'right' },
      ],
      s.byType.map((r) => [r.activityTypeName, String(r.claims), r.rawPoints.toFixed(2), r.countablePoints.toFixed(2), `${r.share}%`]),
    );
    if (s.split) {
      doc.font('Helvetica').fontSize(9).text(
        `${s.framework.name}: speciality-related ${s.split.specialityRelated.countable.toFixed(2)} countable of ${s.split.specialityRelated.raw.toFixed(2)}; other areas ${s.split.other.countable.toFixed(2)} of ${s.split.other.raw.toFixed(2)}.`,
      );
      doc.moveDown(0.5);
    }
  }

  async diaryPdf(practitionerId: bigint, year: number) {
    const p = await this.practitionerHeader(practitionerId);
    const portfolio = await this.portfolio(practitionerId, year);
    return renderPdf(async (doc) => {
      header(doc, `CPD diary ${year}`, `${p.firstName} ${p.otherNames ?? ''} ${p.lastName} · Reg. no. ${p.regNo ?? '—'}${p.specialization ? ` · ${p.specialization.name}` : ''}`);
      doc.font('Helvetica').fontSize(10).text(
        `Points: ${portfolio.points.toFixed(2)} of ${portfolio.required} required (${portfolio.performance}%). Countable towards compliance: ${portfolio.countablePoints.toFixed(2)}. Status: ${portfolio.exempted ? 'Exempted' : portfolio.compliant ? 'Compliant' : 'Not yet compliant'}.`,
      );
      doc.moveDown();
      await this.groupedSection(doc, practitionerId, year);
      doc.font('Helvetica-Bold').fontSize(11).text('Diary entries');
      doc.moveDown(0.3);
      table(
        doc,
        [
          { label: 'Date', width: 70 },
          { label: 'Activity', width: 200 },
          { label: 'Type', width: 105 },
          { label: 'Method', width: 60 },
          { label: 'Points', width: 60, align: 'right' },
        ],
        portfolio.diary.map((d) => [dateOnly(d.claimedAt), `${d.name}${d.provider ? `\n${d.provider}` : ''}`, d.activityType?.name ?? '', d.method, num(d.cpdPoints).toFixed(2)]),
      );
      doc.font('Helvetica').fontSize(8).fillColor('#666').text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    });
  }

  async certificatePdf(practitionerId: bigint, year: number) {
    const p = await this.practitionerHeader(practitionerId);
    const c = await this.compliance.evaluate(practitionerId, year);
    const points = await this.points(practitionerId, year);
    return renderPdf(async (doc) => {
      doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).lineWidth(3).strokeColor(BRAND).stroke();
      doc.moveDown(3).fillColor(BRAND).font('Helvetica-Bold').fontSize(26).text('Certificate of CPD Compliance', { align: 'center' });
      doc.moveDown().fillColor('#000').font('Helvetica').fontSize(13).text('This is to certify that', { align: 'center' });
      doc.moveDown(0.5).font('Helvetica-Bold').fontSize(20).text(`${p.firstName} ${p.otherNames ?? ''} ${p.lastName}`.replace(/\s+/g, ' '), { align: 'center' });
      doc.font('Helvetica').fontSize(12).text(`Registration number ${p.regNo ?? '—'}${p.specialization ? ` · ${p.specialization.name}` : ''}`, { align: 'center' });
      doc.moveDown();
      const status = c.exemption ? 'was exempted from the CPD requirement' : c.evaluation.compliant ? 'has met the CPD requirement' : 'has NOT yet met the CPD requirement';
      doc.fontSize(13).text(`${status} for the year ${year}`, { align: 'center' });
      doc.moveDown(0.5).fontSize(11).text(`Points recorded: ${round2(points).toFixed(2)} · Countable: ${c.evaluation.countablePoints.toFixed(2)} of ${c.framework.totalRequiredPoints} required (${c.framework.name})`, { align: 'center' });
      if (c.evaluation.buckets.length) {
        doc.moveDown(0.5);
        for (const b of c.evaluation.buckets) doc.fontSize(10).text(`${b.name}: ${b.points.toFixed(2)} of ${b.required} ${b.passed ? '✓' : '✗'}`, { align: 'center' });
      }
      doc.moveDown(1.5);
      doc.x = doc.page.margins.left;
      await this.groupedSection(doc, practitionerId, year);
      doc.moveDown(2).fontSize(9).fillColor('#555').text(`Issued ${dateOnly(new Date())}. Verify at the ICPD portal using the registration number.`, { align: 'center' });
    });
  }
}
