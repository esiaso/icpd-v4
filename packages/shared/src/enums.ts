export const ROLES = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  REGULATOR_CPD_OFFICER: 'Regulator CPD Officer',
  PROVIDER_COORDINATOR: 'Provider Coordinator',
  PROVIDER: 'Provider',
  PRACTITIONER: 'Practitioner',
  PUBLIC_USER: 'Public User',
} as const;
export type RoleName = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSIONS = {
  READ_ADMIN_PANEL: 'Read Admin Panel',
  READ_PROVIDER_PANEL: 'Read Provider Panel',
  READ_DEVELOPER_PANEL: 'Read Developer Panel',
  MANAGE_USERS: 'Manage Users',
  DELETE_USER: 'Can delete user',
  MANAGE_PRACTITIONERS: 'Manage Practitioners',
  EDIT_PRACTITIONER: 'Can Edit practitioner',
  EXEMPT_PRACTITIONER: 'Can Exempt Practitioner',
  PROCESS_APPLICATIONS: 'Can Process Applications',
  MANAGE_PROVIDERS: 'Manage Providers',
  MANAGE_ACTIVITIES: 'Manage Activities',
  MANAGE_CLAIMS: 'Manage Claims',
  MANAGE_SETTINGS: 'Can Manage Settings',
  MANAGE_PAGES: 'Can Manage Pages',
  MANAGE_APPS: 'Can Manage Apps',
} as const;
export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const P = PERMISSIONS;
const ALL = Object.values(P);
/** Seeded role → permission map (section 3). Super Admin bypasses checks entirely. */
export const ROLE_PERMISSIONS: Record<RoleName, PermissionName[]> = {
  'Super Admin': ALL,
  Admin: ALL,
  'Regulator CPD Officer': [
    P.READ_ADMIN_PANEL, P.MANAGE_PRACTITIONERS, P.EDIT_PRACTITIONER, P.EXEMPT_PRACTITIONER,
    P.PROCESS_APPLICATIONS, P.MANAGE_PROVIDERS, P.MANAGE_ACTIVITIES, P.MANAGE_CLAIMS,
  ],
  'Provider Coordinator': [P.READ_PROVIDER_PANEL],
  Provider: [P.READ_PROVIDER_PANEL, P.READ_DEVELOPER_PANEL],
  Practitioner: [],
  'Public User': [],
};

export const PRACTITIONER_STATUSES = [
  'presubmission', 'submitted', 'screening', 'returned', 'approved', 'registered', 'incomplete',
] as const;
export type PractitionerStatus = (typeof PRACTITIONER_STATUSES)[number];

export const APPLICATION_STEPS = [
  'profile', 'photo', 'academic', 'specialities', 'workplace', 'preview',
] as const;
export type ApplicationStep = (typeof APPLICATION_STEPS)[number];

export const CLAIM_METHODS = ['token', 'attendance', 'API', 'nontoken'] as const;
export type ClaimMethod = (typeof CLAIM_METHODS)[number];

export const NON_TOKEN_STATUSES = ['Pending', 'Yes', 'Rejected', 'No'] as const;
export type NonTokenStatus = (typeof NON_TOKEN_STATUSES)[number];

export const TOKEN_STATUSES = ['unclaimed', 'claimed', 'expired'] as const;
export type TokenStatus = (typeof TOKEN_STATUSES)[number];

export const DELIVERY_MODES = ['physical', 'online', 'hybrid'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const IMPORT_STATUSES = ['unprocessed', 'processed', 'failed', 'revoked'] as const;

export const API_APP_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLOCKED'] as const;
export const API_APP_TYPES = ['WEB', 'MOBILE', 'IOT'] as const;

export const PROVIDER_STATUSES = ['active', 'inactive', 'suspended'] as const;

export const COMPLIANCE_SCOPES = ['speciality', 'category', 'default'] as const;
export const BUCKET_SOURCES = ['speciality_related', 'other', 'any'] as const;
export type BucketSource = (typeof BUCKET_SOURCES)[number];

export const TIMEZONE = 'Africa/Nairobi';
export const DEFAULT_ANNUAL_REQUIREMENT = 50;
