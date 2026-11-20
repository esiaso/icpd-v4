function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const config = {
  get env() {
    return process.env.NODE_ENV ?? 'development';
  },
  get isProd() {
    return this.env === 'production';
  },
  get isTest() {
    return this.env === 'test';
  },
  get port() {
    return Number(process.env.PORT ?? 4000);
  },
  get appUrl() {
    return req('APP_URL', 'http://localhost:3100');
  },
  get apiUrl() {
    return req('API_URL', 'http://localhost:4000');
  },
  get corsOrigins() {
    return (process.env.CORS_ORIGINS ?? this.appUrl).split(',').map((s) => s.trim());
  },
  get jwtAccessSecret() {
    return req('JWT_ACCESS_SECRET', 'dev-access-secret');
  },
  get jwtRefreshSecret() {
    return req('JWT_REFRESH_SECRET', 'dev-refresh-secret');
  },
  accessTtlSeconds: 15 * 60,
  refreshTtlSeconds: 30 * 24 * 60 * 60,
  get redisUrl() {
    return process.env.REDIS_URL ?? 'redis://localhost:6380';
  },
  get mail() {
    return {
      host: process.env.MAIL_HOST ?? 'localhost',
      port: Number(process.env.MAIL_PORT ?? 1026),
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
      from: process.env.MAIL_FROM ?? 'ICPD <no-reply@icpd.local>',
    };
  },
  get s3() {
    return {
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET ?? 'icpd',
      key: process.env.S3_KEY ?? '',
      secret: process.env.S3_SECRET ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
    };
  },
  get recaptchaSecret() {
    return process.env.RECAPTCHA_SECRET ?? '';
  },
  get sso() {
    return {
      server: process.env.SSO_SERVER ?? '',
      clientId: process.env.SSO_CLIENT_ID ?? '',
      clientSecret: process.env.SSO_CLIENT_SECRET ?? '',
      redirectUri: process.env.SSO_REDIRECT_URI ?? '',
    };
  },
  get annualRequirement() {
    return Number(process.env.CPD_ANNUAL_REQUIREMENT ?? 50);
  },
  get maxUploadBytes() {
    return Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024;
  },
  get backupBucket() {
    return process.env.BACKUP_BUCKET ?? 'icpd-backups';
  },
  get quickClaimEnforceExpiry() {
    return (process.env.QUICK_CLAIM_ENFORCE_EXPIRY ?? 'true') !== 'false';
  },
  get disableQueues() {
    return process.env.DISABLE_QUEUES === 'true';
  },
};
