import { Global, Injectable, Module } from '@nestjs/common';
import { DEFAULT_REGNO_RULES, validateRegNo, type RegNoCategoryRule } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';
import { SettingsController } from './settings.controller';

/** Read-side helper for settings and reg-no rules used across modules. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return (row?.value as T) ?? fallback;
  }

  async regNoRules(): Promise<RegNoCategoryRule[]> {
    const cats = await this.prisma.userCategory.findMany({ where: { deletedAt: null, archived: false } });
    return cats.length ? cats.map((c) => ({ prefixLetter: c.prefixLetter, minimumLength: c.minimumLength })) : DEFAULT_REGNO_RULES;
  }

  async checkRegNo(regNo: string | null | undefined) {
    return validateRegNo(regNo, await this.regNoRules());
  }

  async quickClaimEnforceExpiry(): Promise<boolean> {
    return this.get('claims.quickClaimEnforceExpiry', config.quickClaimEnforceExpiry);
  }

  async enforceTypeCaps(): Promise<boolean> {
    return this.get('claims.enforceTypeCaps', true);
  }

  async multiSpecialityMode(): Promise<'primary' | 'strictest'> {
    return this.get('compliance.multiSpecialityMode', 'primary');
  }
}

@Global()
@Module({ controllers: [SettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
