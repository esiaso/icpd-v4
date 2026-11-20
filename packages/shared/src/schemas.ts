import { z } from 'zod';
import { DELIVERY_MODES, BUCKET_SOURCES, COMPLIANCE_SCOPES, API_APP_TYPES, API_APP_STATUSES } from './enums';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const password = z.string().min(8, 'At least 8 characters').max(128);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: z.string().trim().toLowerCase().email(),
  password,
  /** Honeypot: must be empty. */
  website: z.string().max(0).optional(),
  recaptchaToken: z.string().optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  website: z.string().max(0).optional(),
  recaptchaToken: z.string().optional(),
});
export const resetPasswordSchema = z.object({ token: z.string().min(10), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), password });

export const activityTypeSchema = z.object({
  name: z.string().trim().min(2).max(255),
  category: z.string().max(255).optional().nullable(),
  description: z.string().optional().nullable(),
  evidenceRequired: z.string().optional().nullable(),
  cpdPoints: z.coerce.number().min(0).max(999999),
  presenterPoints: z.coerce.number().min(0).default(0),
  moderatorPoints: z.coerce.number().min(0).default(0),
  maxSessionPoints: z.coerce.number().min(0).optional().nullable(),
  maxActivityPoints: z.coerce.number().min(0).optional().nullable(),
  maxYearlyPoints: z.coerce.number().min(0).optional().nullable(),
  claimCondition: z.string().max(50).optional().nullable(),
  deliveryMode: z.coerce.number().int().optional().nullable(),
  initiator: z.coerce.number().int().optional().nullable(),
  eventBased: z.boolean().optional(),
});
export type ActivityTypeInput = z.infer<typeof activityTypeSchema>;

export const activitySchema = z
  .object({
    activityTypeId: z.coerce.number().int().positive(),
    name: z.string().trim().min(2).max(255),
    shortTitle: z.string().max(255).optional().nullable(),
    numSessions: z.coerce.number().int().min(1).max(100),
    releaseDate: dateStr,
    expiryDate: dateStr,
    endTime: z.string().optional().nullable(),
    deliveryMode: z.enum(DELIVERY_MODES),
    venue: z.string().max(255).optional().nullable(),
    venueOnline: z.string().url().optional().nullable().or(z.literal('')),
    city: z.string().max(255).optional().nullable(),
    specializationAreas: z.array(z.coerce.number().int()).default([]),
  })
  .refine((v) => v.expiryDate >= v.releaseDate, {
    path: ['expiryDate'],
    message: 'End date must be on or after the start date',
  });
export type ActivityInput = z.infer<typeof activitySchema>;

export const activityDescriptionSchema = z.object({
  topic: z.string().optional().nullable(),
  objectives: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  coordinator: z.string().optional().nullable(),
  primaryAudience: z.string().optional().nullable(),
  hashtag: z.string().optional().nullable(),
  activityCost: z.string().optional().nullable(),
  subProviderUnit: z.string().optional().nullable(),
});

export const nonTokenClaimSchema = z
  .object({
    activityTypeId: z.coerce.number().int().positive(),
    activityName: z.string().trim().min(2).max(255),
    description: z.string().trim().min(2),
    beginDate: dateStr,
    endDate: dateStr,
    place: z.string().trim().min(1).max(255),
    /** Speciality relevance; empty array = "General / other". */
    specialityIds: z.array(z.coerce.number().int()).default([]),
  })
  .refine((v) => v.endDate >= v.beginDate, {
    path: ['endDate'],
    message: 'End date must be on or after the begin date',
  });
export type NonTokenClaimInput = z.infer<typeof nonTokenClaimSchema>;

export const tokenClaimSchema = z.object({ token: z.string().trim().min(4).max(64) });
export const quickClaimSchema = z.object({
  regNo: z.string().trim().min(2).max(20),
  token: z.string().trim().min(4).max(64),
});

export const generateTokensSchema = z.object({
  count: z.coerce.number().int().min(1).max(5000),
  sessionNo: z.coerce.number().int().min(1),
  validFrom: dateStr,
  expiryDate: dateStr,
});

export const complianceBucketSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(1).max(255),
  source: z.enum(BUCKET_SOURCES),
  minPoints: z.coerce.number().min(0),
  maxCountablePoints: z.coerce.number().min(0).nullable().optional(),
  minDistinctActivityTypes: z.coerce.number().int().min(0).default(1),
  maxPointsPerActivityType: z.coerce.number().min(0).nullable().optional(),
  /** Refers to another bucket by its index in the submitted list. */
  allowOverflowToIndex: z.number().int().nullable().optional(),
  sortOrder: z.number().int().default(0),
});

export const complianceTypeCapSchema = z.object({
  bucketIndex: z.number().int().nullable().optional(),
  activityTypeId: z.coerce.number().int().positive(),
  maxPoints: z.coerce.number().min(0),
  minPoints: z.coerce.number().min(0).nullable().optional(),
});

export const complianceFrameworkSchema = z.object({
  name: z.string().trim().min(2).max(255),
  cpdYearFrom: z.coerce.number().int().min(2000).max(2100),
  cpdYearTo: z.coerce.number().int().min(2000).max(2100).nullable().optional(),
  scope: z.enum(COMPLIANCE_SCOPES),
  specialityId: z.coerce.number().int().nullable().optional(),
  userCategoryId: z.coerce.number().int().nullable().optional(),
  totalRequiredPoints: z.coerce.number().min(0).default(50),
  active: z.boolean().default(true),
  notes: z.string().nullable().optional(),
  buckets: z.array(complianceBucketSchema).default([]),
  typeCaps: z.array(complianceTypeCapSchema).default([]),
});
export type ComplianceFrameworkInput = z.infer<typeof complianceFrameworkSchema>;

export const apiAppSchema = z.object({
  name: z.string().trim().min(2).max(255),
  description: z.string().optional().nullable(),
  url: z.string().url().optional().nullable(),
  providerId: z.coerce.number().int().positive(),
  type: z.enum(API_APP_TYPES),
  status: z.enum(API_APP_STATUSES).default('INACTIVE'),
  note: z.string().optional().nullable(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
