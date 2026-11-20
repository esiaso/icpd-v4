import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

export type Tx = Prisma.TransactionClient;
export type Db = PrismaService | Tx;

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}

/** Soft-delete filter used everywhere. */
export const notDeleted = { deletedAt: null } as const;

export function num(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : Number(v.toString());
}
