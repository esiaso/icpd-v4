import { Injectable } from '@nestjs/common';
import { normalizeRegNo, parseDateOnly, REGNO_EXISTS_ERROR } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';
import { BadRequest, Conflict, Forbidden, NotFound, Unprocessable } from '../common/errors';
import type { AuthUser } from '../common/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { IdentityService } from '../auth/identity.service';
import { StorageService, type UploadedFile } from '../storage/storage.service';

export const STEPS = ['profile', 'photo', 'academic', 'specialities', 'workplace', 'preview'] as const;
/** application step → screening checklist slug */
export const SECTION_OF: Record<string, string> = { profile: 'profile', photo: 'photo', academic: 'academic', specialities: 'specialization', workplace: 'workplace' };
const EDITABLE = ['presubmission', 'returned'];

export interface ProfileInput {
  titleId?: number | null;
  firstName: string;
  otherNames?: string | null;
  lastName: string;
  dob?: string | null;
  email: string;
  mobile1: string;
  mobile2?: string | null;
  nationality: string;
  countryOfResidenceId: number;
  nationalId: string;
  physicalAddress: string;
  postalAddress?: string | null;
  postalCode?: string | null;
  city: string;
  regNo: string;
  categoryId: number;
}

/** Practitioner registration application (spec 5.2). */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly identity: IdentityService,
    private readonly storage: StorageService,
  ) {}

  async mine(user: AuthUser) {
    return this.prisma.practitioner.findFirst({ where: { userId: user.id, deletedAt: null } });
  }

  async mineOrFail(user: AuthUser) {
    const p = await this.mine(user);
    if (!p) throw NotFound('Application');
    return p;
  }

  private editable(p: { status: string }) {
    if (!EDITABLE.includes(p.status)) throw Forbidden('Your application can no longer be edited.');
  }

  /** Validate reg. no. format against categories and uniqueness except the record being edited. */
  async checkRegNo(regNo: string, exceptId?: bigint) {
    const check = await this.settings.checkRegNo(regNo);
    if (!check.valid) throw Unprocessable(check.error!, { fields: { regNo: check.error } }, 'VALIDATION');
    const clash = await this.prisma.practitioner.findFirst({ where: { regNo: check.normalized, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (clash) throw Unprocessable(REGNO_EXISTS_ERROR, { fields: { regNo: REGNO_EXISTS_ERROR } }, 'VALIDATION');
    return check.normalized;
  }

  /** A legacy record to import instead of creating a duplicate (by account email or entered reg. no.). */
  async findLegacy(user: AuthUser, regNo?: string) {
    const r = regNo ? normalizeRegNo(regNo) : null;
    return this.prisma.practitioner.findFirst({
      where: { userId: null, deletedAt: null, OR: [{ email: user.email }, ...(r ? [{ regNo: r }] : [])] },
      select: { id: true, regNo: true, firstName: true, lastName: true, email: true, status: true },
    });
  }

  private async nextApplicationNo() {
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('application_no_seq') AS n`;
    return `R1${String(n).padStart(4, '0')}`;
  }

  private profileData(input: ProfileInput) {
    return {
      titleId: input.titleId ?? null,
      firstName: input.firstName,
      otherNames: input.otherNames ?? null,
      lastName: input.lastName,
      dob: input.dob ? parseDateOnly(input.dob) : null,
      email: input.email,
      mobile1: input.mobile1,
      mobile2: input.mobile2 ?? null,
      nationality: input.nationality,
      countryOfResidenceId: input.countryOfResidenceId,
      nationalId: input.nationalId.trim(),
      physicalAddress: input.physicalAddress,
      postalAddress: input.postalAddress ?? null,
      postalCode: input.postalCode ?? null,
      city: input.city,
      categoryId: input.categoryId,
    };
  }

  private async uniqueFields(input: ProfileInput, exceptId?: bigint) {
    const not = exceptId ? { id: { not: exceptId } } : {};
    const fields: Record<string, string> = {};
    if (await this.prisma.practitioner.findFirst({ where: { email: input.email, deletedAt: null, ...not } })) fields.email = 'This email is already used by another practitioner.';
    if (await this.prisma.practitioner.findFirst({ where: { nationalId: input.nationalId.trim(), deletedAt: null, ...not } })) fields.nationalId = 'This ID / passport number is already registered.';
    if (Object.keys(fields).length) throw Unprocessable(Object.values(fields)[0], { fields }, 'VALIDATION');
  }

  /** Step 1: create the profile, or tell the client to import a legacy record instead. */
  async createProfile(user: AuthUser, input: ProfileInput) {
    const existing = await this.mine(user);
    if (existing) return { practitioner: existing, next: 'preview' as const };
    const legacy = await this.findLegacy(user, input.regNo);
    if (legacy) return { importable: legacy, next: 'import' as const };
    const regNo = await this.checkRegNo(input.regNo);
    await this.uniqueFields(input);
    const p = await this.prisma.practitioner.create({
      data: {
        ...this.profileData(input),
        regNo,
        userId: user.id,
        applicationNo: await this.nextApplicationNo(),
        status: 'presubmission',
        applicationStep: 'photo',
        createdBy: user.id,
      },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { categoryId: input.categoryId } });
    await this.audit.log({ actorId: user.id, logName: 'practitioner-application', event: 'profile-created', subjectType: 'practitioner', subjectId: p.id });
    return { practitioner: p, next: 'photo' as const };
  }

  /**
   * Step 2 (legacy): link an existing practitioner record to this account. To stop anyone
   * claiming someone else's record by reg. no., the record must share the account's email or
   * the applicant must give the same national ID / passport number.
   */
  async importProfile(user: AuthUser, input: { regNo: string; nationalId?: string; mobile1?: string; categoryId?: number }) {
    if (await this.mine(user)) throw Conflict('You already have a practitioner profile.');
    const legacy = await this.prisma.practitioner.findFirst({
      where: { userId: null, deletedAt: null, OR: [{ email: user.email }, { regNo: normalizeRegNo(input.regNo) }] },
    });
    if (!legacy) throw NotFound('Practitioner record');
    const emailMatches = (legacy.email ?? '').toLowerCase() === user.email.toLowerCase();
    const idMatches = !!legacy.nationalId && !!input.nationalId && legacy.nationalId.trim().toUpperCase() === input.nationalId.trim().toUpperCase();
    if (!emailMatches && !idMatches) throw Forbidden('We could not confirm this record is yours. Enter the national ID or passport number on your registration, or contact the regulator.');
    const regNo = legacy.regNo ? legacy.regNo : await this.checkRegNo(input.regNo, legacy.id);
    const dbUser = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const p = await this.prisma.practitioner.update({
      where: { id: legacy.id },
      data: {
        userId: user.id,
        regNo,
        status: 'registered',
        categoryId: input.categoryId ?? dbUser.categoryId ?? legacy.categoryId,
        email: legacy.email ?? user.email,
        mobile1: input.mobile1 ?? legacy.mobile1,
        applicationStep: 'preview',
        updatedBy: user.id,
      },
    });
    const roles = await this.identity.roleNames(user.id);
    await this.identity.syncRoles(user.id, roles.includes('Provider Coordinator') ? ['Practitioner', 'Provider Coordinator'] : ['Practitioner']);
    await this.mail.send(user.email, 'NotifyImport', { name: p.firstName, regNo: p.regNo, url: `${config.appUrl}/practitioner/portfolio` });
    await this.audit.log({ actorId: user.id, logName: 'practitioner-application', event: 'profile-imported', subjectType: 'practitioner', subjectId: p.id });
    return p;
  }

  /** When an application was returned, saving a section marks it Complete on the current verification. */
  private async markSectionComplete(practitionerId: bigint, step: string, actorId: bigint) {
    const slug = SECTION_OF[step];
    if (!slug) return;
    const v = await this.prisma.applicationVerification.findFirst({ where: { practitionerId }, orderBy: { id: 'desc' } });
    if (!v) return;
    await this.prisma.applicationSectionVerification.updateMany({
      where: { verificationId: v.id, sectionName: slug },
      data: { recommendation: 'Complete', notes: 'Updated by applicant', documentRequested: false },
    });
    await this.audit.log({ actorId, logName: 'practitioner-application', event: 'returned-section-updated', subjectType: 'practitioner', subjectId: practitionerId, properties: { section: slug } });
  }

  private async afterSave(p: { id: bigint; status: string; applicationStep: string }, step: (typeof STEPS)[number], actorId: bigint) {
    const nextIdx = Math.min(STEPS.indexOf(step) + 1, STEPS.length - 1);
    const reached = Math.max(STEPS.indexOf(p.applicationStep as any), nextIdx);
    await this.prisma.practitioner.update({ where: { id: p.id }, data: { applicationStep: STEPS[reached], updatedBy: actorId } });
    if (p.status === 'returned') await this.markSectionComplete(p.id, step, actorId);
  }

  async updateProfile(user: AuthUser, input: ProfileInput) {
    const p = await this.mineOrFail(user);
    this.editable(p);
    const regNo = await this.checkRegNo(input.regNo, p.id);
    await this.uniqueFields(input, p.id);
    await this.prisma.practitioner.update({ where: { id: p.id }, data: { ...this.profileData(input), regNo, updatedBy: user.id } });
    await this.afterSave(p, 'profile', user.id);
    return this.mineOrFail(user);
  }

  async uploadPhoto(user: AuthUser, file: UploadedFile | undefined, allowAfterSubmit = false) {
    const p = await this.mineOrFail(user);
    if (!allowAfterSubmit) this.editable(p);
    this.storage.validate(file, 'image', 5 * 1024 * 1024);
    const key = await this.storage.put('photos', file!);
    await this.prisma.practitioner.update({ where: { id: p.id }, data: { photoUrl: key, updatedBy: user.id } });
    await this.prisma.user.update({ where: { id: user.id }, data: { avatarUrl: key } });
    if (!allowAfterSubmit) await this.afterSave(p, 'photo', user.id);
    return { photoUrl: await this.storage.signedUrl(key) };
  }

  async saveAcademics(user: AuthUser, rows: { qualificationId?: number | null; qualification?: string | null; institution?: string | null; country?: string | null; year?: number | null }[]) {
    const p = await this.mineOrFail(user);
    this.editable(p);
    if (!rows.length) throw Unprocessable('Add at least one academic qualification.');
    await this.prisma.$transaction([
      this.prisma.practitionerAcademic.deleteMany({ where: { practitionerId: p.id } }),
      this.prisma.practitionerAcademic.createMany({ data: rows.map((r) => ({ ...r, practitionerId: p.id, createdBy: user.id })) }),
      this.prisma.practitioner.update({
        where: { id: p.id },
        data: { qualifications: rows.map((r) => r.qualification).filter(Boolean).join(', '), qualificationYear: rows[0].year ?? null, qualificationInstitution: rows[0].institution ?? null, qualificationCountry: rows[0].country ?? null },
      }),
    ]);
    await this.afterSave(p, 'academic', user.id);
    return this.prisma.practitionerAcademic.findMany({ where: { practitionerId: p.id } });
  }

  async saveSpecialities(user: AuthUser, input: { primaryId: number; otherIds: number[]; specializationOther?: string | null }, afterRegistration = false) {
    const p = await this.mineOrFail(user);
    if (!afterRegistration) this.editable(p);
    const ids = [...new Set([input.primaryId, ...input.otherIds])];
    const found = await this.prisma.speciality.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw BadRequest('Unknown speciality');
    await this.prisma.$transaction([
      this.prisma.practitionerSpeciality.deleteMany({ where: { practitionerId: p.id } }),
      this.prisma.practitionerSpeciality.createMany({ data: ids.map((id) => ({ practitionerId: p.id, specialityId: id, isPrimary: id === input.primaryId, createdBy: user.id })) }),
      this.prisma.practitioner.update({ where: { id: p.id }, data: { specializationId: input.primaryId, specializationOther: input.specializationOther ?? null } }),
    ]);
    if (afterRegistration) {
      await this.audit.log({ actorId: user.id, logName: 'practitioners', event: 'specialities-changed', subjectType: 'practitioner', subjectId: p.id, properties: input });
    } else await this.afterSave(p, 'specialities', user.id);
    return { ok: true };
  }

  async saveWorkplace(user: AuthUser, rows: { institution: string; facilityId?: number | null; countryId?: number | null; position?: string | null; current?: boolean }[], afterRegistration = false) {
    const p = await this.mineOrFail(user);
    if (!afterRegistration) this.editable(p);
    if (!rows.length) throw Unprocessable('Add at least one workplace or affiliation.');
    const current = rows.find((r) => r.current !== false) ?? rows[0];
    await this.prisma.$transaction([
      this.prisma.practitionerFacility.deleteMany({ where: { practitionerId: p.id } }),
      this.prisma.practitionerFacility.createMany({ data: rows.map((r) => ({ ...r, current: r.current ?? true, practitionerId: p.id, createdBy: user.id })) }),
      this.prisma.practitioner.update({ where: { id: p.id }, data: { workplaceInstitution: current.institution, workplaceCountryId: current.countryId ?? null } }),
    ]);
    if (!afterRegistration) await this.afterSave(p, 'workplace', user.id);
    return { ok: true };
  }

  async preview(user: AuthUser) {
    const p = await this.prisma.practitioner.findFirst({
      where: { userId: user.id, deletedAt: null },
      include: {
        academics: { where: { deletedAt: null } },
        specialities: { include: { speciality: { select: { id: true, name: true } } } },
        facilities: { where: { deletedAt: null } },
        category: { select: { name: true, prefixLetter: true } },
        specialization: { select: { name: true } },
      },
    });
    if (!p) return null;
    const verification = await this.prisma.applicationVerification.findFirst({ where: { practitionerId: p.id }, orderBy: { id: 'desc' }, include: { sections: true } });
    const returned = p.status === 'returned' && verification ? verification.sections.filter((s) => s.recommendation === 'Incomplete') : [];
    return {
      ...p,
      photoSignedUrl: await this.storage.signedUrl(p.photoUrl),
      missing: this.missing(p),
      returnedSections: returned.map((s) => ({ section: s.sectionName, notes: s.notes, documentRequested: s.documentRequested })),
      editable: EDITABLE.includes(p.status),
    };
  }

  private missing(p: { photoUrl: string | null; specializationId: number | null; academics: unknown[]; facilities: unknown[] }) {
    const m: string[] = [];
    if (!p.photoUrl) m.push('photo');
    if (!p.academics.length) m.push('academic');
    if (!p.specializationId) m.push('specialities');
    if (!p.facilities.length) m.push('workplace');
    return m;
  }

  async submit(user: AuthUser) {
    const pv = await this.preview(user);
    if (!pv) throw NotFound('Application');
    if (pv.status !== 'presubmission') throw BadRequest('This application has already been submitted.');
    if (pv.missing.length) throw Unprocessable(`Complete these sections first: ${pv.missing.join(', ')}.`, { missing: pv.missing });
    await this.prisma.practitioner.update({ where: { id: pv.id }, data: { status: 'submitted', dateOfApplication: new Date(), applicationStep: 'preview' } });
    await this.mail.send(user.email, 'NotifySubmission', { name: pv.firstName, applicationNo: pv.applicationNo });
    await this.audit.log({ actorId: user.id, logName: 'practitioner-application', event: 'submitted', subjectType: 'practitioner', subjectId: pv.id });
    return { ok: true, message: `Application ${pv.applicationNo} submitted.` };
  }

  async resubmit(user: AuthUser) {
    const pv = await this.preview(user);
    if (!pv) throw NotFound('Application');
    if (pv.status !== 'returned') throw BadRequest('Only returned applications can be resubmitted.');
    await this.checkRegNo(pv.regNo ?? '', pv.id);
    if (pv.missing.length) throw Unprocessable(`Complete these sections first: ${pv.missing.join(', ')}.`, { missing: pv.missing });
    await this.prisma.practitioner.update({ where: { id: pv.id }, data: { status: 'submitted' } });
    await this.mail.send(user.email, 'NotifyReSubmission', { name: pv.firstName, applicationNo: pv.applicationNo });
    await this.audit.log({ actorId: user.id, logName: 'practitioner-application', event: 'resubmitted', subjectType: 'practitioner', subjectId: pv.id });
    return { ok: true, message: `Application ${pv.applicationNo} resubmitted.` };
  }

  /** Registered practitioners may keep contact details current. */
  async updateContact(user: AuthUser, input: { mobile1: string; mobile2?: string | null; physicalAddress: string; postalAddress?: string | null; postalCode?: string | null; city: string; countryOfResidenceId?: number | null }) {
    const p = await this.mineOrFail(user);
    await this.prisma.practitioner.update({ where: { id: p.id }, data: { ...input, updatedBy: user.id } });
    await this.audit.log({ actorId: user.id, logName: 'practitioners', event: 'contact-updated', subjectType: 'practitioner', subjectId: p.id });
    return { ok: true };
  }
}
