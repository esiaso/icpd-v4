import { Injectable } from '@nestjs/common';
import { nairobiToday, parseDateOnly } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';
import { BadRequest, NotFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { IdentityService } from '../auth/identity.service';
import { StorageService } from '../storage/storage.service';

const LOG = 'practitioner-application';

/** Regulator screening workflow (spec 5.3). */
@Injectable()
export class ScreeningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly identity: IdentityService,
    private readonly storage: StorageService,
  ) {}

  async screeningChecklist() {
    const all = await this.prisma.checklist.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    return all.filter((c) => {
      const m = (c.module as any[]) ?? [];
      return m.some((x) => x?.module === 'practitioner') && m.some((x) => x?.stage === 'screening');
    });
  }

  private async load(id: bigint) {
    const p = await this.prisma.practitioner.findFirst({
      where: { id, deletedAt: null },
      include: {
        user: { select: { email: true, name: true } },
        academics: { where: { deletedAt: null } },
        specialities: { include: { speciality: { select: { id: true, name: true } } } },
        facilities: { where: { deletedAt: null } },
        category: true,
        specialization: { select: { name: true } },
      },
    });
    if (!p) throw NotFound('Application');
    return p;
  }

  private current(practitionerId: bigint) {
    return this.prisma.applicationVerification.findFirst({ where: { practitionerId }, orderBy: { id: 'desc' }, include: { sections: true } });
  }

  async detail(id: bigint) {
    const p = await this.load(id);
    const [checklist, verification, history] = await Promise.all([
      this.screeningChecklist(),
      this.current(id),
      this.prisma.auditLog.findMany({ where: { logName: LOG, subjectType: 'practitioner', subjectId: id.toString() }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const sections = checklist.map((c) => {
      const s = verification?.sections.find((x) => x.checklistId === c.id);
      return { checklistId: c.id, slug: c.slug, item: c.item, recommendation: s?.recommendation ?? null, notes: s?.notes ?? null, documentRequested: s?.documentRequested ?? false };
    });
    const allVerified = sections.length > 0 && sections.every((s) => s.recommendation);
    const anyIncomplete = sections.some((s) => s.recommendation === 'Incomplete');
    return {
      practitioner: { ...p, photoSignedUrl: await this.storage.signedUrl(p.photoUrl) },
      verification,
      sections,
      actions: {
        canStart: ['submitted'].includes(p.status),
        canReturn: p.status === 'screening' && anyIncomplete,
        canAdvance: p.status === 'screening' && allVerified && !anyIncomplete,
        canApprove: p.status === 'approved',
        canDelete: p.status === 'presubmission',
      },
      history,
    };
  }

  /** Start processing: needs a practitioner/screening checklist; copies forward Complete sections. */
  async start(id: bigint, officerId: bigint) {
    const p = await this.load(id);
    if (p.status !== 'submitted') throw BadRequest('Only submitted applications can be screened.');
    const checklist = await this.screeningChecklist();
    if (!checklist.length) throw BadRequest('There is no screening checklist');
    const previous = await this.current(id);
    await this.prisma.$transaction(async (tx) => {
      const v = await tx.applicationVerification.create({
        data: { practitionerId: id, officerUserId: officerId, stage: 'screening', applicationReceivedDate: p.dateOfApplication ?? new Date() },
      });
      const carried = previous?.sections.filter((s) => s.recommendation === 'Complete') ?? [];
      for (const s of carried) {
        await tx.applicationSectionVerification.create({
          data: { practitionerId: id, officerUserId: s.officerUserId, verificationId: v.id, checklistId: s.checklistId, sectionName: s.sectionName, recommendation: 'Complete', notes: s.notes, stage: 'screening' },
        });
      }
      await tx.practitioner.update({ where: { id }, data: { status: 'screening' } });
    });
    await this.audit.log({ actorId: officerId, logName: LOG, event: 'screening-started', subjectType: 'practitioner', subjectId: id });
  }

  async screenSection(id: bigint, slug: string, input: { recommendation: 'Complete' | 'Incomplete'; notes?: string | null }, officerId: bigint) {
    const p = await this.load(id);
    if (p.status !== 'screening') throw BadRequest('Start screening first.');
    const c = (await this.screeningChecklist()).find((x) => x.slug === slug);
    if (!c) throw NotFound('Checklist section');
    const v = await this.current(id);
    if (!v) throw BadRequest('Start screening first.');
    await this.prisma.applicationSectionVerification.upsert({
      where: { verificationId_checklistId: { verificationId: v.id, checklistId: c.id } },
      create: { practitionerId: id, officerUserId: officerId, verificationId: v.id, checklistId: c.id, sectionName: slug, recommendation: input.recommendation, notes: input.notes ?? null, stage: 'screening' },
      update: { officerUserId: officerId, recommendation: input.recommendation, notes: input.notes ?? null },
    });
    await this.audit.log({ actorId: officerId, logName: LOG, event: 'section-screened', subjectType: 'practitioner', subjectId: id, properties: { section: slug, ...input } });
  }

  async requestDocument(id: bigint, slug: string, requested: boolean, notes: string | null, officerId: bigint) {
    const v = await this.current(id);
    const c = (await this.screeningChecklist()).find((x) => x.slug === slug);
    if (!v || !c) throw BadRequest('Start screening first.');
    await this.prisma.applicationSectionVerification.upsert({
      where: { verificationId_checklistId: { verificationId: v.id, checklistId: c.id } },
      create: { practitionerId: id, officerUserId: officerId, verificationId: v.id, checklistId: c.id, sectionName: slug, recommendation: 'Incomplete', notes, documentRequested: requested, stage: 'screening' },
      update: { documentRequested: requested, ...(requested ? { recommendation: 'Incomplete', notes } : {}) },
    });
    await this.audit.log({ actorId: officerId, logName: LOG, event: requested ? 'document-requested' : 'document-request-removed', subjectType: 'practitioner', subjectId: id, properties: { section: slug, notes } });
  }

  async returnApplication(id: bigint, officerId: bigint) {
    const d = await this.detail(id);
    if (!d.actions.canReturn) throw BadRequest('Mark at least one section Incomplete before returning the application.');
    const returned = d.sections.filter((s) => s.recommendation === 'Incomplete').map((s) => ({ section: s.item, slug: s.slug, notes: s.notes }));
    await this.prisma.$transaction([
      this.prisma.applicationVerification.update({ where: { id: d.verification!.id }, data: { returnedSections: returned, recommendation: 'Incomplete' } }),
      this.prisma.practitioner.update({ where: { id }, data: { status: 'returned' } }),
    ]);
    const p = d.practitioner;
    await this.mail.send(p.user?.email ?? p.email, 'NotifyReturn', { name: p.firstName, applicationNo: p.applicationNo, sections: returned, url: `${config.appUrl}/practitioner/registration/preview` });
    await this.audit.log({ actorId: officerId, logName: LOG, event: 'returned', subjectType: 'practitioner', subjectId: id, properties: { returned } });
  }

  async completeScreening(id: bigint, officerId: bigint) {
    const d = await this.detail(id);
    if (!d.actions.canAdvance) throw BadRequest('Every section must be verified and Complete.');
    await this.prisma.$transaction([
      this.prisma.applicationVerification.update({ where: { id: d.verification!.id }, data: { recommendation: 'Complete' } }),
      this.prisma.practitioner.update({ where: { id }, data: { status: 'approved' } }),
    ]);
    await this.audit.log({ actorId: officerId, logName: LOG, event: 'screening-completed', subjectType: 'practitioner', subjectId: id });
  }

  /** Optional chairman's comment, stored on the current verification (defect #11 fixed). */
  async chairmanReview(id: bigint, comment: string, officerId: bigint) {
    const v = await this.current(id);
    if (!v) throw BadRequest('This application has not been screened.');
    await this.prisma.applicationVerification.update({ where: { id: v.id }, data: { approvalComment: comment } });
    await this.audit.log({ actorId: officerId, logName: LOG, event: 'chairman-review', subjectType: 'practitioner', subjectId: id, properties: { comment } });
  }

  async approve(id: bigint, officerId: bigint) {
    const p = await this.load(id);
    if (p.status !== 'approved') throw BadRequest('Complete screening before registering the practitioner.');
    await this.prisma.practitioner.update({ where: { id }, data: { status: 'registered', dateRegistered: parseDateOnly(nairobiToday()) } });
    if (p.userId) {
      const roles = await this.identity.roleNames(p.userId);
      await this.identity.syncRoles(p.userId, roles.includes('Provider Coordinator') ? ['Practitioner', 'Provider Coordinator'] : ['Practitioner']);
    }
    await this.mail.send(p.user?.email ?? p.email, 'NotifyApproval', { name: p.firstName, applicationNo: p.applicationNo, url: `${config.appUrl}/practitioner/portfolio` });
    await this.audit.log({ actorId: officerId, logName: LOG, event: 'approved', subjectType: 'practitioner', subjectId: id });
  }

  async deleteApplication(id: bigint, officerId: bigint) {
    const p = await this.load(id);
    if (p.status !== 'presubmission') throw BadRequest('Only applications that were never submitted can be deleted.');
    await this.prisma.practitioner.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: officerId, userId: null } });
    await this.mail.send(p.user?.email ?? p.email, 'NotifyApplicationDelete', { name: p.firstName, applicationNo: p.applicationNo });
    await this.audit.log({ actorId: officerId, logName: LOG, event: 'deleted', subjectType: 'practitioner', subjectId: id });
  }
}
