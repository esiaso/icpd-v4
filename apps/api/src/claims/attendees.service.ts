import { Injectable, OnModuleInit } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { normalizeRegNo } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { BadRequest, NotFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { JobsService } from '../jobs/jobs.service';
import { StorageService, type UploadedFile } from '../storage/storage.service';
import { ClaimError, PointsService } from '../points/points.service';

const HEADINGS = ['regno', 'fullname', 'email', 'activitysession'];

/** Attendee list import and processing (spec 5.6 "Attendee list import"). */
@Injectable()
export class AttendeesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
    private readonly points: PointsService,
  ) {}

  onModuleInit() {
    this.jobs.register('attendees.process-all', (d, progress) => this.processAll(BigInt(d.activityId), d.actorId ? BigInt(d.actorId) : null, progress));
    this.jobs.register('attendees.reprocess-practitioner', (d) => this.reprocessForPractitioner(BigInt(d.practitionerId), d.actorId ? BigInt(d.actorId) : null));
  }

  async template() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Attendees');
    ws.addRow(HEADINGS).font = { bold: true };
    ws.addRow(['A1234', 'Jane Doe', 'jane@example.com', 1]);
    ws.columns.forEach((c) => (c.width = 22));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Read rows from .xlsx (and .csv). Old binary .xls must be re-saved as .xlsx. */
  async parse(file: UploadedFile): Promise<{ regNo: string; fullName?: string; email?: string; session: number }[]> {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.xls')) throw BadRequest('Old Excel (.xls) files are not supported. Open the file and save it as .xlsx, then upload again.');
    const wb = new ExcelJS.Workbook();
    let ws: ExcelJS.Worksheet | undefined;
    if (name.endsWith('.csv')) {
      const { Readable } = await import('stream');
      ws = await wb.csv.read(Readable.from(file.buffer));
    } else {
      this.storage.validate(file, 'excel', 10 * 1024 * 1024);
      await wb.xlsx.load(file.buffer as any);
      ws = wb.worksheets[0];
    }
    if (!ws) throw BadRequest('The file has no worksheet.');
    const head = (ws.getRow(1).values as any[]).map((v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z]/g, ''));
    const col = (h: string) => head.indexOf(h);
    if (col('regno') < 0) throw BadRequest(`The first row must contain the headings: ${HEADINGS.join(', ')}.`);
    const out: { regNo: string; fullName?: string; email?: string; session: number }[] = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const cell = (h: string) => {
        const c = col(h);
        if (c < 0) return undefined;
        const v = row.getCell(c).value as any;
        return v === null || v === undefined ? undefined : String(typeof v === 'object' ? (v.text ?? v.result ?? '') : v).trim();
      };
      const regNo = normalizeRegNo(cell('regno'));
      if (!regNo) return;
      const session = Number(cell('activitysession') || 1);
      out.push({ regNo, fullName: cell('fullname'), email: cell('email'), session: Number.isFinite(session) && session >= 1 ? Math.floor(session) : 1 });
    });
    return out;
  }

  async import(activityId: bigint, file: UploadedFile, actorId: bigint) {
    if (!file) throw BadRequest('Choose a file to upload.');
    if (file.size > 10 * 1024 * 1024) throw BadRequest('File is too large (max 10 MB)');
    const activity = await this.prisma.activity.findUniqueOrThrow({ where: { id: activityId } });
    const rows = await this.parse(file);
    const existing = new Set(
      (await this.prisma.attendeeImport.findMany({ where: { activityId, deletedAt: null }, select: { regNo: true, session: true } })).map((r) => `${r.regNo}:${r.session}`),
    );
    let imported = 0;
    let skipped = 0;
    const data: any[] = [];
    for (const r of rows) {
      const k = `${r.regNo}:${r.session}`;
      if (existing.has(k) || r.session > Math.max(1, activity.numSessions)) {
        skipped++;
        continue;
      }
      existing.add(k);
      data.push({ activityId, regNo: r.regNo, fullName: r.fullName, email: r.email, session: r.session, status: 'unprocessed', createdBy: actorId });
      imported++;
    }
    if (data.length) await this.prisma.attendeeImport.createMany({ data });
    await this.audit.log({ actorId, logName: 'attendees', event: 'imported', subjectType: 'activity', subjectId: activityId, properties: { imported, skipped, file: file.originalname } });
    return { imported, skipped };
  }

  /** Process one imported row: attendance claim or a recorded failure. */
  async processOne(importId: bigint, actorId: bigint | null) {
    const row = await this.prisma.attendeeImport.findFirst({ where: { id: importId, deletedAt: null }, include: { activity: { include: { type: true } } } });
    if (!row) throw NotFound('Imported attendee');
    if (row.status === 'processed') return { status: 'processed', message: 'Already processed' };
    const p = await this.prisma.practitioner.findFirst({ where: { regNo: row.regNo, deletedAt: null }, orderBy: { id: 'asc' } });
    const done = async (status: 'processed' | 'failed', comment: string) => {
      await this.prisma.attendeeImport.update({ where: { id: row.id }, data: { status, comment, dateProcessed: new Date(), updatedBy: actorId } });
      return { status, message: comment };
    };
    if (!p) return done('failed', 'Not Found');
    try {
      await this.points.claimAttendance(p, row.activity, actorId);
      return done('processed', 'Points awarded!');
    } catch (e) {
      if (e instanceof ClaimError) return done('failed', 'Max claims made');
      throw e;
    }
  }

  async processAll(activityId: bigint, actorId: bigint | null, progress?: (d: number, t: number) => Promise<void>) {
    const rows = await this.prisma.attendeeImport.findMany({ where: { activityId, deletedAt: null, status: { in: ['unprocessed', 'failed'] } }, select: { id: true }, orderBy: { id: 'asc' } });
    let awarded = 0;
    let failed = 0;
    for (const [i, r] of rows.entries()) {
      const res = await this.processOne(r.id, actorId);
      res.status === 'processed' ? awarded++ : failed++;
      if (i % 20 === 0) await progress?.(i, rows.length);
    }
    await progress?.(rows.length, rows.length);
    await this.audit.log({ actorId, logName: 'attendees', event: 'processed-all', subjectType: 'activity', subjectId: activityId, properties: { processed: rows.length, awarded, failed } });
    return { processed: rows.length, awarded, failed, message: `${rows.length} processed, ${awarded} awarded, ${failed} failed` };
  }

  /** Regulator: retry all failed imports for one practitioner (e.g. after late registration). */
  async reprocessForPractitioner(practitionerId: bigint, actorId: bigint | null) {
    const p = await this.prisma.practitioner.findUniqueOrThrow({ where: { id: practitionerId } });
    if (!p.regNo) throw BadRequest('This practitioner has no registration number.');
    const rows = await this.prisma.attendeeImport.findMany({ where: { regNo: p.regNo, status: 'failed', deletedAt: null }, select: { id: true } });
    let awarded = 0;
    let failed = 0;
    for (const r of rows) (await this.processOne(r.id, actorId)).status === 'processed' ? awarded++ : failed++;
    await this.audit.log({ actorId, logName: 'attendees', event: 'reprocessed-for-practitioner', subjectType: 'practitioner', subjectId: practitionerId, properties: { processed: rows.length, awarded, failed } });
    return { processed: rows.length, awarded, failed, message: `${rows.length} processed, ${awarded} awarded, ${failed} failed` };
  }
}
