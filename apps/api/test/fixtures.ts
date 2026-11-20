import { prisma, uniq } from './helpers';

export const PROVIDER_INPUT = () => ({
  name: `Provider ${uniq('')}`,
  regNo: `CPD/${uniq('')}`,
  specialities: [1],
  physicalAddress: 'Upper Hill',
  postalAddress: 'P.O. Box 1',
  postalCode: '00100',
  town: 'Nairobi',
  phone: '0700000000',
  email: `${uniq('p')}@prov.test`,
  website: 'https://provider.test',
});

export async function makeProvider(o: Partial<{ status: string }> = {}) {
  const { specialities, ...rest } = PROVIDER_INPUT();
  return prisma.provider.create({ data: { ...rest, specialities, status: o.status ?? 'active' } });
}

export async function addMember(providerId: bigint, userId: bigint, status = 'Active') {
  return prisma.providerUser.create({ data: { providerId, userId, status } });
}

export async function typeByName(name: string) {
  return prisma.activityType.findFirstOrThrow({ where: { name } });
}

let seq = 1000;
/** A practitioner with a unique, valid reg. no. */
export async function makePractitioner(o: Partial<{ regNo: string; userId: bigint; status: any; specializationId: number; categoryId: number; email: string }> = {}) {
  const regNo = o.regNo ?? `A${String(++seq)}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 8);
  return prisma.practitioner.create({
    data: {
      regNo,
      firstName: 'Test',
      lastName: `Doc${seq}`,
      email: o.email ?? `${uniq('doc')}@doc.test`,
      status: o.status ?? 'registered',
      userId: o.userId,
      specializationId: o.specializationId,
      categoryId: o.categoryId,
    },
  });
}

export async function makeActivity(providerId: bigint, o: Partial<{ typeName: string; numSessions: number; published: boolean; releaseDate: string; expiryDate: string; specializationAreas: number[] }> = {}) {
  const type = await typeByName(o.typeName ?? 'CME session');
  const n = o.numSessions ?? 2;
  const year = new Date().getUTCFullYear();
  return prisma.activity.create({
    data: {
      providerId,
      activityTypeId: type.id,
      name: `Activity ${uniq('')}`,
      numSessions: n,
      multiSessions: n > 1,
      cpdPoints: type.cpdPoints,
      maxPoints: Number(type.cpdPoints) * Math.max(1, n),
      releaseDate: new Date(`${o.releaseDate ?? `${year}-01-01`}T00:00:00Z`),
      expiryDate: new Date(`${o.expiryDate ?? `${year + 1}-12-31`}T00:00:00Z`),
      published: o.published ?? true,
      datePublished: o.published === false ? null : new Date(),
      specializationAreas: o.specializationAreas ?? [],
    },
  });
}
