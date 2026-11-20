-- Database-side defaults so raw SQL (legacy migration, reports) gets the same values as Prisma.
ALTER TABLE users ALTER COLUMN "publicId" SET DEFAULT gen_random_uuid();
ALTER TABLE practitioners ALTER COLUMN "publicId" SET DEFAULT gen_random_uuid();
ALTER TABLE providers ALTER COLUMN "publicId" SET DEFAULT gen_random_uuid();
ALTER TABLE activities ALTER COLUMN "publicId" SET DEFAULT gen_random_uuid();
ALTER TABLE non_token_claims ALTER COLUMN "publicId" SET DEFAULT gen_random_uuid();
ALTER TABLE api_consumer_apps ALTER COLUMN "publicId" SET DEFAULT gen_random_uuid();
