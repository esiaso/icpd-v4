import { Body, Controller, Delete, Get, Module, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS, type Pagination } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser, RequirePermissions, RequireVerified, type AuthUser } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { PageQuery, pageArgs, paged, parseId, sortBy } from '../common/pagination';
import type { UploadedFile as UFile } from '../storage/storage.service';
import { RegistrationService } from './registration.service';
import { ScreeningService } from './screening.service';

const opt = z.string().trim().optional().nullable();
const profileSchema = z.object({
  titleId: z.coerce.number().int().optional().nullable(),
  firstName: z.string().trim().min(1, 'Required'),
  otherNames: opt,
  lastName: z.string().trim().min(1, 'Required'),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
  email: z.string().trim().toLowerCase().email(),
  mobile1: z.string().trim().min(9, 'Enter a phone number'),
  mobile2: opt,
  nationality: z.string().trim().min(2, 'Required'),
  countryOfResidenceId: z.coerce.number().int({ message: 'Required' }),
  nationalId: z.string().trim().min(4, 'Enter your ID or passport number'),
  physicalAddress: z.string().trim().min(2, 'Required'),
  postalAddress: opt,
  postalCode: opt,
  city: z.string().trim().min(2, 'Required'),
  regNo: z.string().trim().min(2, 'Required'),
  categoryId: z.coerce.number().int({ message: 'Required' }),
});
const academicsSchema = z.object({
  rows: z.array(z.object({ qualificationId: z.coerce.number().int().optional().nullable(), qualification: z.string().trim().min(2), institution: z.string().trim().min(2), country: opt, year: z.coerce.number().int().min(1950).max(2100).optional().nullable() })).min(1),
});
const specialitiesSchema = z.object({ primaryId: z.coerce.number().int(), otherIds: z.array(z.coerce.number().int()).default([]), specializationOther: opt });
const workplaceSchema = z.object({
  rows: z.array(z.object({ institution: z.string().trim().min(2), facilityId: z.coerce.number().int().optional().nullable(), countryId: z.coerce.number().int().optional().nullable(), position: opt, current: z.boolean().optional() })).min(1),
});
const contactSchema = profileSchema.pick({ mobile1: true, mobile2: true, physicalAddress: true, postalAddress: true, postalCode: true, city: true }).extend({ countryOfResidenceId: z.coerce.number().int().optional().nullable() });

/** The signed-in user's own registration application (spec 5.2). Email must be verified. */
@ApiTags('practitioner: registration')
@RequireVerified()
@Controller('me/application')
export class ApplicationController {
  constructor(private readonly reg: RegistrationService) {}

  @Get()
  preview(@CurrentUser() u: AuthUser) {
    return this.reg.preview(u);
  }

  @Get('legacy')
  async legacy(@CurrentUser() u: AuthUser, @Query('regNo') regNo?: string) {
    return { importable: await this.reg.findLegacy(u, regNo) };
  }

  @Post('profile')
  create(@CurrentUser() u: AuthUser, @Body(Z(profileSchema)) b: any) {
    return this.reg.createProfile(u, { ...b, dob: b.dob || null });
  }

  @Post('import')
  import(@CurrentUser() u: AuthUser, @Body(Z(z.object({ regNo: z.string().trim().min(2), nationalId: z.string().optional(), mobile1: z.string().optional(), categoryId: z.coerce.number().int().optional() }))) b: any) {
    return this.reg.importProfile(u, b);
  }

  @Put('profile')
  update(@CurrentUser() u: AuthUser, @Body(Z(profileSchema)) b: any) {
    return this.reg.updateProfile(u, { ...b, dob: b.dob || null });
  }

  @Post('photo')
  @UseInterceptors(FileInterceptor('file'))
  photo(@CurrentUser() u: AuthUser, @UploadedFile() file: UFile) {
    return this.reg.uploadPhoto(u, file);
  }

  @Put('academics')
  academics(@CurrentUser() u: AuthUser, @Body(Z(academicsSchema)) b: z.infer<typeof academicsSchema>) {
    return this.reg.saveAcademics(u, b.rows);
  }

  @Put('specialities')
  specialities(@CurrentUser() u: AuthUser, @Body(Z(specialitiesSchema)) b: z.infer<typeof specialitiesSchema>) {
    return this.reg.saveSpecialities(u, b);
  }

  @Put('workplace')
  workplace(@CurrentUser() u: AuthUser, @Body(Z(workplaceSchema)) b: z.infer<typeof workplaceSchema>) {
    return this.reg.saveWorkplace(u, b.rows);
  }

  @Post('submit')
  submit(@CurrentUser() u: AuthUser) {
    return this.reg.submit(u);
  }

  @Post('resubmit')
  resubmit(@CurrentUser() u: AuthUser) {
    return this.reg.resubmit(u);
  }
}

/** Registered practitioner profile maintenance (spec 9: profile, edit, speciality, workplace, photo). */
@ApiTags('practitioner: profile')
@Controller('me/profile')
export class ProfileController {
  constructor(private readonly reg: RegistrationService) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.reg.preview(u);
  }

  @Put('contact')
  contact(@CurrentUser() u: AuthUser, @Body(Z(contactSchema)) b: any) {
    return this.reg.updateContact(u, b);
  }

  @Post('photo')
  @UseInterceptors(FileInterceptor('file'))
  photo(@CurrentUser() u: AuthUser, @UploadedFile() file: UFile) {
    return this.reg.uploadPhoto(u, file, true);
  }

  @Put('specialities')
  specialities(@CurrentUser() u: AuthUser, @Body(Z(specialitiesSchema)) b: z.infer<typeof specialitiesSchema>) {
    return this.reg.saveSpecialities(u, b, true);
  }

  @Put('workplace')
  workplace(@CurrentUser() u: AuthUser, @Body(Z(workplaceSchema)) b: z.infer<typeof workplaceSchema>) {
    return this.reg.saveWorkplace(u, b.rows, true);
  }
}

/** Regulator screening (spec 5.3). */
@ApiTags('regulator: applications')
@RequirePermissions(PERMISSIONS.READ_ADMIN_PANEL, PERMISSIONS.PROCESS_APPLICATIONS)
@Controller('regulator/applications')
export class ScreeningController {
  constructor(private readonly prisma: PrismaService, private readonly screening: ScreeningService) {}

  /** list=new (submitted) | all (not incomplete/presubmission) | incomplete | <status> */
  @Get()
  async list(@Query(PageQuery()) q: Pagination & { list?: string }) {
    const where: any = { deletedAt: null };
    const l = q.list ?? 'new';
    if (l === 'new') where.status = 'submitted';
    else if (l === 'all') where.status = { notIn: ['incomplete', 'presubmission'] };
    else where.status = l;
    if (q.search) {
      where.OR = [
        { applicationNo: { contains: q.search, mode: 'insensitive' } },
        { regNo: { contains: q.search.replace(/\s+/g, ''), mode: 'insensitive' } },
        { lastName: { contains: q.search, mode: 'insensitive' } },
        { firstName: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.practitioner.findMany({
        where,
        ...pageArgs(q),
        orderBy: sortBy(q, ['dateOfApplication', 'lastName', 'applicationNo', 'status'], { dateOfApplication: 'asc' }),
        select: { id: true, applicationNo: true, regNo: true, firstName: true, lastName: true, status: true, applicationStep: true, dateOfApplication: true, email: true, category: { select: { name: true } } },
      }),
      this.prisma.practitioner.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @Get('checklist')
  checklist() {
    return this.screening.screeningChecklist();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.screening.detail(parseId(id));
  }

  @Post(':id/start')
  async start(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.screening.start(parseId(id), u.id);
    return { ok: true };
  }

  @Post(':id/sections/:slug')
  async screen(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('slug') slug: string, @Body(Z(z.object({ recommendation: z.enum(['Complete', 'Incomplete']), notes: z.string().optional().nullable() }))) b: any) {
    await this.screening.screenSection(parseId(id), slug, b, u.id);
    return { ok: true };
  }

  @Post(':id/sections/:slug/request-document')
  async request(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('slug') slug: string, @Body(Z(z.object({ notes: z.string().optional().nullable() }))) b: any) {
    await this.screening.requestDocument(parseId(id), slug, true, b.notes ?? null, u.id);
    return { ok: true };
  }

  @Delete(':id/sections/:slug/request-document')
  async unrequest(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('slug') slug: string) {
    await this.screening.requestDocument(parseId(id), slug, false, null, u.id);
    return { ok: true };
  }

  @Post(':id/return')
  async ret(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.screening.returnApplication(parseId(id), u.id);
    return { ok: true, message: 'Application returned and the applicant notified' };
  }

  @Post(':id/complete-screening')
  async complete(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.screening.completeScreening(parseId(id), u.id);
    return { ok: true, message: 'Screening complete' };
  }

  @Post(':id/chairman-review')
  async chairman(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ comment: z.string().trim().min(2) }))) b: { comment: string }) {
    await this.screening.chairmanReview(parseId(id), b.comment, u.id);
    return { ok: true };
  }

  @Post(':id/approve')
  async approve(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.screening.approve(parseId(id), u.id);
    return { ok: true, message: 'Practitioner registered and notified' };
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.screening.deleteApplication(parseId(id), u.id);
    return { ok: true };
  }
}

@Module({
  controllers: [ApplicationController, ProfileController, ScreeningController],
  providers: [RegistrationService, ScreeningService],
  exports: [RegistrationService],
})
export class RegistrationModule {}
