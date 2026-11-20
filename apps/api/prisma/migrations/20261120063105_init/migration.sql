-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "PractitionerStatus" AS ENUM ('presubmission', 'submitted', 'screening', 'returned', 'approved', 'registered', 'incomplete');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('unclaimed', 'claimed');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('unprocessed', 'processed', 'failed', 'revoked');

-- CreateEnum
CREATE TYPE "ClaimMethod" AS ENUM ('token', 'attendance', 'API', 'nontoken');

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "publicId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMPTZ,
    "avatarUrl" TEXT,
    "categoryId" INTEGER,
    "lastLoginAt" TIMESTAMPTZ,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" BIGINT NOT NULL,
    "roleId" INTEGER NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "userId" BIGINT NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("userId","permissionId")
);

-- CreateTable
CREATE TABLE "auth_logs" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT,
    "email" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "loginAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loginSuccessful" BOOLEAN NOT NULL,
    "logoutAt" TIMESTAMPTZ,
    "location" TEXT,

    CONSTRAINT "auth_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "usedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "usedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "replacedBy" BIGINT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_access_tokens" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "personal_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_credentials" (
    "id" BIGSERIAL NOT NULL,
    "practitionerId" BIGINT NOT NULL,
    "sha1Hash" TEXT NOT NULL,
    "legacyRoleId" INTEGER,
    "usedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "prefixLetter" VARCHAR(2) NOT NULL,
    "minimumLength" INTEGER NOT NULL DEFAULT 2,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "user_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specialities" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "specialities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "titles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" VARCHAR(3),
    "legacyId" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_qualifications" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "academic_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_schools" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "medical_schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facilities" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "county" TEXT,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "evidenceRequired" TEXT,
    "cpdPoints" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "presenterPoints" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "moderatorPoints" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "maxSessionPoints" DECIMAL(8,2),
    "maxActivityPoints" DECIMAL(8,2),
    "maxYearlyPoints" DECIMAL(8,2),
    "claimCondition" TEXT,
    "deliveryMode" INTEGER,
    "initiator" INTEGER,
    "eventBased" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "activity_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "updatedBy" BIGINT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "practitioners" (
    "id" BIGSERIAL NOT NULL,
    "publicId" UUID NOT NULL,
    "userId" BIGINT,
    "regNo" TEXT,
    "applicationNo" VARCHAR(12),
    "titleId" INTEGER,
    "firstName" TEXT NOT NULL,
    "otherNames" TEXT,
    "lastName" TEXT NOT NULL,
    "dob" DATE,
    "nationalId" TEXT,
    "email" CITEXT,
    "mobile1" TEXT,
    "mobile2" TEXT,
    "nationality" TEXT,
    "countryOfResidenceId" INTEGER,
    "physicalAddress" TEXT,
    "postalAddress" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "categoryId" INTEGER,
    "specializationId" INTEGER,
    "specializationOther" TEXT,
    "qualifications" TEXT,
    "qualificationYear" INTEGER,
    "qualificationInstitution" TEXT,
    "qualificationCountry" TEXT,
    "workplaceInstitution" TEXT,
    "workplaceCountryId" INTEGER,
    "photoUrl" TEXT,
    "status" "PractitionerStatus" NOT NULL DEFAULT 'presubmission',
    "applicationStep" TEXT NOT NULL DEFAULT 'profile',
    "dateOfApplication" TIMESTAMPTZ,
    "dateRegistered" DATE,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "practitioners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioner_specialities" (
    "id" BIGSERIAL NOT NULL,
    "practitionerId" BIGINT NOT NULL,
    "specialityId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" BIGINT,

    CONSTRAINT "practitioner_specialities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioner_academics" (
    "id" BIGSERIAL NOT NULL,
    "practitionerId" BIGINT NOT NULL,
    "qualificationId" INTEGER,
    "qualification" TEXT,
    "institution" TEXT,
    "country" TEXT,
    "year" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "practitioner_academics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioner_facilities" (
    "id" BIGSERIAL NOT NULL,
    "practitionerId" BIGINT NOT NULL,
    "facilityId" INTEGER,
    "institution" TEXT NOT NULL,
    "countryId" INTEGER,
    "position" TEXT,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "practitioner_facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioner_logs" (
    "id" BIGSERIAL NOT NULL,
    "practitionerId" BIGINT NOT NULL,
    "logType" TEXT NOT NULL,
    "logDate" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdBy" BIGINT,

    CONSTRAINT "practitioner_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklists" (
    "id" SERIAL NOT NULL,
    "item" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "module" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_verifications" (
    "id" BIGSERIAL NOT NULL,
    "practitionerId" BIGINT NOT NULL,
    "officerUserId" BIGINT,
    "checklistId" INTEGER,
    "stage" TEXT NOT NULL DEFAULT 'screening',
    "recommendation" TEXT,
    "applicationReceivedDate" TIMESTAMPTZ,
    "returnedSections" JSONB,
    "approvalComment" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "application_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_section_verifications" (
    "id" BIGSERIAL NOT NULL,
    "practitionerId" BIGINT NOT NULL,
    "officerUserId" BIGINT,
    "verificationId" BIGINT NOT NULL,
    "checklistId" INTEGER NOT NULL,
    "sectionName" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "notes" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'screening',
    "documentRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "application_section_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" BIGSERIAL NOT NULL,
    "publicId" UUID NOT NULL,
    "regNo" TEXT,
    "name" TEXT NOT NULL,
    "specialities" JSONB NOT NULL DEFAULT '[]',
    "contactName" TEXT,
    "physicalAddress" TEXT,
    "street" TEXT,
    "building" TEXT,
    "postalAddress" TEXT,
    "postalCode" TEXT,
    "town" TEXT,
    "phone" TEXT,
    "fixedLine" TEXT,
    "email" CITEXT,
    "website" TEXT,
    "facebook" TEXT,
    "twitter" TEXT,
    "linkedin" TEXT,
    "logoUrl" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "effectiveDate" DATE,
    "dateAdded" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy" BIGINT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_users" (
    "id" BIGSERIAL NOT NULL,
    "providerId" BIGINT NOT NULL,
    "userId" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "provider_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_status_history" (
    "id" BIGSERIAL NOT NULL,
    "providerId" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "effectiveDate" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" BIGINT,

    CONSTRAINT "provider_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" BIGSERIAL NOT NULL,
    "publicId" UUID NOT NULL,
    "activityNo" TEXT,
    "providerId" BIGINT NOT NULL,
    "activityTypeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "shortTitle" TEXT,
    "topic" TEXT,
    "objectives" TEXT,
    "description" TEXT,
    "coordinator" TEXT,
    "deliveryMode" TEXT NOT NULL DEFAULT 'physical',
    "venue" TEXT,
    "venueOnline" TEXT,
    "city" TEXT,
    "gpsLat" DECIMAL(10,7),
    "gpsLng" DECIMAL(10,7),
    "primaryAudience" TEXT,
    "specializationAreas" JSONB NOT NULL DEFAULT '[]',
    "releaseDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "endTime" TEXT,
    "numSessions" INTEGER NOT NULL DEFAULT 1,
    "multiSessions" BOOLEAN NOT NULL DEFAULT false,
    "cpdPoints" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "maxPoints" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "datePublished" TIMESTAMPTZ,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "visibility" TEXT DEFAULT 'public',
    "onlineRegistration" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "dateArchived" TIMESTAMPTZ,
    "posterUrl" TEXT,
    "qrCodeUrl" TEXT,
    "shortenedUrl" TEXT,
    "hashtag" TEXT,
    "activityCost" TEXT,
    "subProviderUnit" TEXT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_presenters" (
    "id" BIGSERIAL NOT NULL,
    "activityId" BIGINT NOT NULL,
    "regNo" TEXT NOT NULL,
    "titleId" INTEGER,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "otherNames" TEXT,
    "topic" TEXT,
    "portfolio" TEXT,
    "affiliation" TEXT,
    "pointsAwarded" BOOLEAN NOT NULL DEFAULT false,
    "dateProcessed" TIMESTAMPTZ,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "activity_presenters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_moderators" (
    "id" BIGSERIAL NOT NULL,
    "activityId" BIGINT NOT NULL,
    "regNo" TEXT NOT NULL,
    "titleId" INTEGER,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "portfolio" TEXT,
    "pointsAwarded" BOOLEAN NOT NULL DEFAULT false,
    "dateProcessed" TIMESTAMPTZ,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "activity_moderators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_tokens" (
    "id" BIGSERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "activityId" BIGINT NOT NULL,
    "sessionNo" INTEGER NOT NULL DEFAULT 1,
    "batch" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "status" "TokenStatus" NOT NULL DEFAULT 'unclaimed',
    "claimedBy" BIGINT,
    "claimedAt" TIMESTAMPTZ,
    "issued" BOOLEAN NOT NULL DEFAULT false,
    "qrCodeUrl" TEXT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "activity_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendee_imports" (
    "id" BIGSERIAL NOT NULL,
    "activityId" BIGINT NOT NULL,
    "regNo" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "session" INTEGER NOT NULL DEFAULT 1,
    "status" "ImportStatus" NOT NULL DEFAULT 'unprocessed',
    "comment" TEXT,
    "dateProcessed" TIMESTAMPTZ,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "attendee_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpd_claims" (
    "id" BIGSERIAL NOT NULL,
    "practitionerId" BIGINT NOT NULL,
    "activityId" BIGINT,
    "nonTokenClaimId" BIGINT,
    "method" "ClaimMethod" NOT NULL,
    "methodSource" TEXT,
    "tokenTrail" TEXT NOT NULL DEFAULT '',
    "cpdPoints" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "calYear" INTEGER NOT NULL,
    "claimedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apiClaimId" TEXT,
    "apiActivityName" TEXT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "cpd_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpd_claim_entries" (
    "id" BIGSERIAL NOT NULL,
    "claimId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "token" TEXT,
    "points" DECIMAL(8,2) NOT NULL,
    "activityTypeId" INTEGER NOT NULL,
    "specialityIds" JSONB NOT NULL DEFAULT '[]',
    "calYear" INTEGER NOT NULL,
    "awardedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" BIGINT,

    CONSTRAINT "cpd_claim_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_token_claims" (
    "id" BIGSERIAL NOT NULL,
    "publicId" UUID NOT NULL,
    "practitionerId" BIGINT NOT NULL,
    "activityTypeId" INTEGER NOT NULL,
    "activityName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "beginDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "place" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "specialityIds" JSONB NOT NULL DEFAULT '[]',
    "claimDate" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "approvedAt" TIMESTAMPTZ,
    "approvedBy" BIGINT,
    "rejectedAt" TIMESTAMPTZ,
    "rejectedBy" BIGINT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "non_token_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" BIGSERIAL NOT NULL,
    "profilePractitionerId" BIGINT,
    "authorUserId" BIGINT,
    "comment" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "itemId" BIGINT,
    "date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exemptions" (
    "id" BIGSERIAL NOT NULL,
    "practitionerId" BIGINT NOT NULL,
    "regNo" TEXT,
    "cpdYear" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "exemptedBy" BIGINT,
    "pointsAttained" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "postType" TEXT NOT NULL DEFAULT 'FORM',
    "ip" TEXT,
    "dateExempted" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "exemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_frameworks" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "cpdYearFrom" INTEGER NOT NULL,
    "cpdYearTo" INTEGER,
    "scope" TEXT NOT NULL,
    "specialityId" INTEGER,
    "userCategoryId" INTEGER,
    "totalRequiredPoints" DECIMAL(8,2) NOT NULL DEFAULT 50,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "compliance_frameworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_buckets" (
    "id" SERIAL NOT NULL,
    "frameworkId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "minPoints" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "maxCountablePoints" DECIMAL(8,2),
    "minDistinctActivityTypes" INTEGER NOT NULL DEFAULT 1,
    "maxPointsPerActivityType" DECIMAL(8,2),
    "allowOverflowTo" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "compliance_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_type_caps" (
    "id" SERIAL NOT NULL,
    "frameworkId" INTEGER NOT NULL,
    "bucketId" INTEGER,
    "activityTypeId" INTEGER NOT NULL,
    "maxPoints" DECIMAL(8,2) NOT NULL,
    "minPoints" DECIMAL(8,2),

    CONSTRAINT "compliance_type_caps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_results" (
    "id" BIGSERIAL NOT NULL,
    "practitionerId" BIGINT NOT NULL,
    "cpdYear" INTEGER NOT NULL,
    "frameworkId" INTEGER,
    "rawPoints" DECIMAL(8,2) NOT NULL,
    "countablePoints" DECIMAL(8,2) NOT NULL,
    "buckets" JSONB NOT NULL DEFAULT '[]',
    "compliant" BOOLEAN NOT NULL,
    "exempted" BOOLEAN NOT NULL DEFAULT false,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "computedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "description" TEXT,
    "content" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "specialities" JSONB NOT NULL DEFAULT '[]',
    "shortFile" TEXT,
    "fullFileName" TEXT,
    "filePath" TEXT,
    "details" TEXT,
    "type" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_consumer_apps" (
    "id" SERIAL NOT NULL,
    "publicId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "providerId" BIGINT,
    "type" TEXT NOT NULL DEFAULT 'WEB',
    "status" TEXT NOT NULL DEFAULT 'INACTIVE',
    "note" TEXT,
    "key" TEXT,
    "secretHash" TEXT,
    "isCouncil" BOOLEAN NOT NULL DEFAULT false,
    "rotatedAt" TIMESTAMPTZ,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" BIGINT,
    "updatedBy" BIGINT,
    "deletedAt" TIMESTAMPTZ,
    "deletedBy" BIGINT,

    CONSTRAINT "api_consumer_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_logs" (
    "id" BIGSERIAL NOT NULL,
    "providerId" BIGINT,
    "appId" INTEGER,
    "logType" TEXT NOT NULL,
    "logDate" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdBy" BIGINT,

    CONSTRAINT "api_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_logs" (
    "id" BIGSERIAL NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ip" TEXT,
    "userId" BIGINT,
    "consumerId" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actorId" BIGINT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "event" TEXT NOT NULL,
    "logName" TEXT NOT NULL,
    "description" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "batchId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_logs" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "logType" TEXT NOT NULL,
    "logDate" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "user_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "createdBy" BIGINT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_publicId_key" ON "users"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_legacyId_key" ON "users"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- CreateIndex
CREATE INDEX "auth_logs_userId_loginAt_idx" ON "auth_logs"("userId", "loginAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "personal_access_tokens_tokenHash_key" ON "personal_access_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_credentials_practitionerId_key" ON "legacy_credentials"("practitionerId");

-- CreateIndex
CREATE UNIQUE INDEX "user_categories_legacyId_key" ON "user_categories"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "specialities_legacyId_key" ON "specialities"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "titles_legacyId_key" ON "titles"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "countries_legacyId_key" ON "countries"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "academic_qualifications_legacyId_key" ON "academic_qualifications"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "medical_schools_legacyId_key" ON "medical_schools"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "facilities_legacyId_key" ON "facilities"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "activity_types_legacyId_key" ON "activity_types"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_publicId_key" ON "practitioners"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_userId_key" ON "practitioners"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_applicationNo_key" ON "practitioners"("applicationNo");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_legacyId_key" ON "practitioners"("legacyId");

-- CreateIndex
CREATE INDEX "practitioners_regNo_idx" ON "practitioners"("regNo");

-- CreateIndex
CREATE INDEX "practitioners_nationalId_idx" ON "practitioners"("nationalId");

-- CreateIndex
CREATE INDEX "practitioners_email_idx" ON "practitioners"("email");

-- CreateIndex
CREATE INDEX "practitioners_status_idx" ON "practitioners"("status");

-- CreateIndex
CREATE UNIQUE INDEX "practitioner_specialities_practitionerId_specialityId_key" ON "practitioner_specialities"("practitionerId", "specialityId");

-- CreateIndex
CREATE INDEX "practitioner_logs_practitionerId_logDate_idx" ON "practitioner_logs"("practitionerId", "logDate");

-- CreateIndex
CREATE INDEX "application_verifications_practitionerId_idx" ON "application_verifications"("practitionerId");

-- CreateIndex
CREATE UNIQUE INDEX "application_section_verifications_verificationId_checklistI_key" ON "application_section_verifications"("verificationId", "checklistId");

-- CreateIndex
CREATE UNIQUE INDEX "providers_publicId_key" ON "providers"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "providers_legacyId_key" ON "providers"("legacyId");

-- CreateIndex
CREATE INDEX "provider_users_userId_status_idx" ON "provider_users"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "activities_publicId_key" ON "activities"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "activities_activityNo_key" ON "activities"("activityNo");

-- CreateIndex
CREATE UNIQUE INDEX "activities_legacyId_key" ON "activities"("legacyId");

-- CreateIndex
CREATE INDEX "activities_providerId_published_idx" ON "activities"("providerId", "published");

-- CreateIndex
CREATE INDEX "activities_published_releaseDate_idx" ON "activities"("published", "releaseDate");

-- CreateIndex
CREATE UNIQUE INDEX "activity_presenters_legacyId_key" ON "activity_presenters"("legacyId");

-- CreateIndex
CREATE INDEX "activity_presenters_activityId_regNo_idx" ON "activity_presenters"("activityId", "regNo");

-- CreateIndex
CREATE UNIQUE INDEX "activity_moderators_legacyId_key" ON "activity_moderators"("legacyId");

-- CreateIndex
CREATE INDEX "activity_moderators_activityId_regNo_idx" ON "activity_moderators"("activityId", "regNo");

-- CreateIndex
CREATE UNIQUE INDEX "activity_tokens_token_key" ON "activity_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "activity_tokens_legacyId_key" ON "activity_tokens"("legacyId");

-- CreateIndex
CREATE INDEX "activity_tokens_activityId_sessionNo_idx" ON "activity_tokens"("activityId", "sessionNo");

-- CreateIndex
CREATE INDEX "activity_tokens_activityId_batch_idx" ON "activity_tokens"("activityId", "batch");

-- CreateIndex
CREATE INDEX "activity_tokens_claimedBy_activityId_idx" ON "activity_tokens"("claimedBy", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "attendee_imports_legacyId_key" ON "attendee_imports"("legacyId");

-- CreateIndex
CREATE INDEX "attendee_imports_activityId_regNo_session_idx" ON "attendee_imports"("activityId", "regNo", "session");

-- CreateIndex
CREATE INDEX "attendee_imports_regNo_status_idx" ON "attendee_imports"("regNo", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cpd_claims_nonTokenClaimId_key" ON "cpd_claims"("nonTokenClaimId");

-- CreateIndex
CREATE UNIQUE INDEX "cpd_claims_legacyId_key" ON "cpd_claims"("legacyId");

-- CreateIndex
CREATE INDEX "cpd_claims_practitionerId_calYear_idx" ON "cpd_claims"("practitionerId", "calYear");

-- CreateIndex
CREATE INDEX "cpd_claims_practitionerId_activityId_idx" ON "cpd_claims"("practitionerId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "cpd_claim_entries_token_key" ON "cpd_claim_entries"("token");

-- CreateIndex
CREATE INDEX "cpd_claim_entries_claimId_idx" ON "cpd_claim_entries"("claimId");

-- CreateIndex
CREATE INDEX "cpd_claim_entries_calYear_activityTypeId_idx" ON "cpd_claim_entries"("calYear", "activityTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "non_token_claims_publicId_key" ON "non_token_claims"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "non_token_claims_legacyId_key" ON "non_token_claims"("legacyId");

-- CreateIndex
CREATE INDEX "non_token_claims_practitionerId_status_idx" ON "non_token_claims"("practitionerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "comments_legacyId_key" ON "comments"("legacyId");

-- CreateIndex
CREATE INDEX "comments_type_itemId_idx" ON "comments"("type", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "exemptions_legacyId_key" ON "exemptions"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "exemptions_practitionerId_cpdYear_key" ON "exemptions"("practitionerId", "cpdYear");

-- CreateIndex
CREATE INDEX "compliance_frameworks_scope_specialityId_userCategoryId_cpd_idx" ON "compliance_frameworks"("scope", "specialityId", "userCategoryId", "cpdYearFrom");

-- CreateIndex
CREATE INDEX "compliance_results_cpdYear_compliant_idx" ON "compliance_results"("cpdYear", "compliant");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_results_practitionerId_cpdYear_key" ON "compliance_results"("practitionerId", "cpdYear");

-- CreateIndex
CREATE UNIQUE INDEX "pages_slug_key" ON "pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "api_consumer_apps_publicId_key" ON "api_consumer_apps"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "api_consumer_apps_name_key" ON "api_consumer_apps"("name");

-- CreateIndex
CREATE UNIQUE INDEX "api_consumer_apps_key_key" ON "api_consumer_apps"("key");

-- CreateIndex
CREATE UNIQUE INDEX "api_consumer_apps_legacyId_key" ON "api_consumer_apps"("legacyId");

-- CreateIndex
CREATE INDEX "api_logs_providerId_logDate_idx" ON "api_logs"("providerId", "logDate");

-- CreateIndex
CREATE INDEX "request_logs_createdAt_idx" ON "request_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_log_logName_createdAt_idx" ON "audit_log"("logName", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_subjectType_subjectId_idx" ON "audit_log"("subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "user_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_logs" ADD CONSTRAINT "auth_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "user_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_specializationId_fkey" FOREIGN KEY ("specializationId") REFERENCES "specialities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_specialities" ADD CONSTRAINT "practitioner_specialities_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_specialities" ADD CONSTRAINT "practitioner_specialities_specialityId_fkey" FOREIGN KEY ("specialityId") REFERENCES "specialities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_academics" ADD CONSTRAINT "practitioner_academics_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_facilities" ADD CONSTRAINT "practitioner_facilities_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_logs" ADD CONSTRAINT "practitioner_logs_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_verifications" ADD CONSTRAINT "application_verifications_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_section_verifications" ADD CONSTRAINT "application_section_verifications_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_section_verifications" ADD CONSTRAINT "application_section_verifications_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "application_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_users" ADD CONSTRAINT "provider_users_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_users" ADD CONSTRAINT "provider_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_status_history" ADD CONSTRAINT "provider_status_history_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "activity_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_presenters" ADD CONSTRAINT "activity_presenters_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_moderators" ADD CONSTRAINT "activity_moderators_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_tokens" ADD CONSTRAINT "activity_tokens_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_tokens" ADD CONSTRAINT "activity_tokens_claimedBy_fkey" FOREIGN KEY ("claimedBy") REFERENCES "practitioners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendee_imports" ADD CONSTRAINT "attendee_imports_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpd_claims" ADD CONSTRAINT "cpd_claims_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpd_claims" ADD CONSTRAINT "cpd_claims_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpd_claims" ADD CONSTRAINT "cpd_claims_nonTokenClaimId_fkey" FOREIGN KEY ("nonTokenClaimId") REFERENCES "non_token_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpd_claim_entries" ADD CONSTRAINT "cpd_claim_entries_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "cpd_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_token_claims" ADD CONSTRAINT "non_token_claims_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_token_claims" ADD CONSTRAINT "non_token_claims_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "activity_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exemptions" ADD CONSTRAINT "exemptions_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_buckets" ADD CONSTRAINT "compliance_buckets_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "compliance_frameworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_type_caps" ADD CONSTRAINT "compliance_type_caps_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "compliance_frameworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_results" ADD CONSTRAINT "compliance_results_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_consumer_apps" ADD CONSTRAINT "api_consumer_apps_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
