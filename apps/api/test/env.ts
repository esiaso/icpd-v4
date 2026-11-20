process.env.NODE_ENV = 'test';
process.env.DISABLE_QUEUES = 'true';
process.env.TZ = 'UTC';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://icpd:icpd@localhost:55433/icpd_test?schema=public';
process.env.RECAPTCHA_SECRET = '';
process.env.JWT_ACCESS_SECRET = 'test-access';
process.env.JWT_REFRESH_SECRET = 'test-refresh';
