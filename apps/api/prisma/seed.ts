/**
 * Seed: roles, permissions (spec 3 only; legacy IREC/NACOSTI seeders dropped, defect #14),
 * screening checklist, reference data and a Super Admin. Idempotent.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from '@icpd/shared';

const prisma = new PrismaClient();

const SPECIALITIES = [
  'General Practice', 'Anaesthesiology', 'Cardiology', 'Dermatology', 'Emergency Medicine', 'Family Medicine',
  'General Surgery', 'Internal Medicine', 'Neurology', 'Neurosurgery', 'Obstetrics and Gynaecology',
  'Ophthalmology', 'Orthopaedics', 'Otorhinolaryngology (ENT)', 'Paediatrics', 'Pathology', 'Psychiatry',
  'Public Health', 'Radiology', 'Urology', 'Oncology', 'Plastic Surgery', 'Cardiothoracic Surgery',
  'General Dentistry', 'Oral and Maxillofacial Surgery', 'Orthodontics', 'Periodontology', 'Prosthodontics',
  'Paediatric Dentistry', 'Community Dentistry',
];

const CATEGORIES = [
  { name: 'Medical Practitioner', prefixLetter: 'A', minimumLength: 2 },
  { name: 'Dental Practitioner', prefixLetter: 'B', minimumLength: 2 },
  { name: 'Foreign Medical Practitioner (Temporary)', prefixLetter: 'C', minimumLength: 2 },
  { name: 'Foreign Dental Practitioner (Temporary)', prefixLetter: 'D', minimumLength: 2 },
  { name: 'Medical Intern', prefixLetter: 'E', minimumLength: 2 },
  { name: 'Dental Intern', prefixLetter: 'F', minimumLength: 2 },
  { name: 'Community Oral Health Officer', prefixLetter: 'G', minimumLength: 2 },
];

const TITLES = ['Dr', 'Prof', 'Mr', 'Mrs', 'Ms', 'Assoc. Prof'];
const QUALIFICATIONS = ['MBChB', 'BDS', 'MMed', 'MDS', 'MSc', 'MPH', 'PhD', 'Fellowship', 'Diploma'];
const COUNTRIES: [string, string][] = [
  ['Kenya', 'KE'], ['Uganda', 'UG'], ['Tanzania', 'TZ'], ['Rwanda', 'RW'], ['Burundi', 'BI'], ['South Sudan', 'SS'],
  ['Ethiopia', 'ET'], ['Somalia', 'SO'], ['Democratic Republic of the Congo', 'CD'], ['Nigeria', 'NG'], ['Ghana', 'GH'],
  ['South Africa', 'ZA'], ['Egypt', 'EG'], ['Zambia', 'ZM'], ['Zimbabwe', 'ZW'], ['Malawi', 'MW'], ['India', 'IN'],
  ['Pakistan', 'PK'], ['China', 'CN'], ['Cuba', 'CU'], ['Russia', 'RU'], ['Ukraine', 'UA'], ['United Kingdom', 'GB'],
  ['United States', 'US'], ['Germany', 'DE'], ['Other', 'XX'],
];

/** Sample activity types; the regulator should review points and caps before go-live. */
const ACTIVITY_TYPES = [
  { name: 'Conference / Scientific meeting', category: 'Event', cpdPoints: 5, presenterPoints: 3, moderatorPoints: 2, maxYearlyPoints: 30, deliveryMode: 1, initiator: 1, eventBased: true },
  { name: 'Workshop / Skills training', category: 'Event', cpdPoints: 3, presenterPoints: 2, moderatorPoints: 1, deliveryMode: 1, initiator: 1, eventBased: true },
  { name: 'CME session', category: 'Event', cpdPoints: 2, presenterPoints: 2, moderatorPoints: 1, deliveryMode: 1, initiator: 1, eventBased: true },
  { name: 'Webinar / Online CME', category: 'Online', cpdPoints: 2, presenterPoints: 2, moderatorPoints: 1, deliveryMode: 2, initiator: 1, eventBased: true },
  { name: 'Online course (e-learning)', category: 'Online', cpdPoints: 5, deliveryMode: 2, initiator: 1, eventBased: false },
  { name: 'Journal club', category: 'Event', cpdPoints: 1, presenterPoints: 1, deliveryMode: 1, initiator: 1, eventBased: true },
  { name: 'Publication in a peer-reviewed journal', category: 'Self-directed', cpdPoints: 10, maxSessionPoints: 10, maxYearlyPoints: 20, evidenceRequired: 'Copy of the published article', eventBased: false },
  { name: 'Postgraduate study', category: 'Self-directed', cpdPoints: 25, maxSessionPoints: 50, claimCondition: 'once', evidenceRequired: 'Letter from the institution', eventBased: false },
  { name: 'Internship supervision', category: 'Self-directed', cpdPoints: 10, maxSessionPoints: 10, claimCondition: 'once', evidenceRequired: 'Letter from the supervising facility', eventBased: false },
  { name: 'Other (with evidence)', category: 'Self-directed', cpdPoints: 1, maxSessionPoints: 10, evidenceRequired: 'Certificate or attendance letter', eventBased: false },
];

const CHECKLIST = [
  { item: 'Personal profile', slug: 'profile' },
  { item: 'Passport photo', slug: 'photo' },
  { item: 'Academic qualifications', slug: 'academic' },
  { item: 'Specialization', slug: 'specialization' },
  { item: 'Workplace / affiliation', slug: 'workplace' },
];

const PAGES = [
  { slug: 'about', title: 'About ICPD', content: '<p>The ICPD platform records Continuing Professional Development (CPD) for medical and dental practitioners in Kenya.</p>' },
  { slug: 'terms', title: 'Terms of use', content: '<p>Terms of use. Replace with the regulator\'s approved text.</p>' },
  { slug: 'privacy', title: 'Privacy policy', content: '<p>Privacy policy. Replace with the regulator\'s approved text.</p>' },
  { slug: 'how-to-claim', title: 'How to claim CPD points', content: '<p>Scan the QR code on your token card or enter the token in your portfolio.</p>' },
];

async function upsertByName<T extends { name: string }>(model: any, rows: T[]) {
  for (const r of rows) {
    const existing = await model.findFirst({ where: { name: r.name } });
    if (!existing) await model.create({ data: r });
  }
}

async function main() {
  for (const name of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { name }, create: { name }, update: {} });
  }
  for (const name of Object.values(ROLES)) {
    const role = await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
    const perms = await prisma.permission.findMany({ where: { name: { in: ROLE_PERMISSIONS[name] } } });
    for (const p of perms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        create: { roleId: role.id, permissionId: p.id },
        update: {},
      });
    }
  }

  await upsertByName(prisma.userCategory, CATEGORIES);
  await upsertByName(prisma.speciality, SPECIALITIES.map((name) => ({ name })));
  await upsertByName(prisma.title, TITLES.map((name) => ({ name })));
  await upsertByName(prisma.academicQualification, QUALIFICATIONS.map((name) => ({ name })));
  await upsertByName(prisma.country, COUNTRIES.map(([name, code]) => ({ name, code })));
  await upsertByName(prisma.activityType, ACTIVITY_TYPES);

  for (const [i, c] of CHECKLIST.entries()) {
    const existing = await prisma.checklist.findFirst({ where: { slug: c.slug } });
    if (!existing) {
      await prisma.checklist.create({
        data: { ...c, sortOrder: i, evidence: [], module: [{ module: 'practitioner' }, { stage: 'screening' }] },
      });
    }
  }
  for (const p of PAGES) {
    await prisma.page.upsert({ where: { slug: p.slug }, create: { ...p, status: 'published' }, update: {} });
  }
  await prisma.setting.upsert({
    where: { key: 'compliance.multiSpecialityMode' },
    create: { key: 'compliance.multiSpecialityMode', value: 'primary' },
    update: {},
  });

  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@icpd.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';
  let admin = await prisma.user.findUnique({ where: { email } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { name: 'System Administrator', email, passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: new Date() },
    });
  }
  const superRole = await prisma.role.findUniqueOrThrow({ where: { name: ROLES.SUPER_ADMIN } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: superRole.id } },
    create: { userId: admin.id, roleId: superRole.id },
    update: {},
  });
  console.log(`Seed complete. Super Admin: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
