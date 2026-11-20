import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService, type Db } from '../common/prisma.service';

export interface AuditEntry {
  actorId?: bigint | null;
  logName: string;
  event: string;
  subjectType?: string;
  subjectId?: bigint | number | string | null;
  description?: string;
  properties?: Record<string, unknown>;
  batchId?: string;
}

function jsonSafe(v: unknown): any {
  return JSON.parse(JSON.stringify(v ?? {}, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
}

/** Audit trail for every state-changing action (spec 8). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(e: AuditEntry, db: Db = this.prisma) {
    await db.auditLog.create({
      data: {
        actorId: e.actorId ?? null,
        logName: e.logName,
        event: e.event,
        subjectType: e.subjectType,
        subjectId: e.subjectId === null || e.subjectId === undefined ? null : String(e.subjectId),
        description: e.description,
        properties: jsonSafe(e.properties),
        batchId: e.batchId,
      },
    });
  }

  async practitionerLog(practitionerId: bigint, logType: string, notes: string, createdBy?: bigint | null, db: Db = this.prisma) {
    await db.practitionerLog.create({ data: { practitionerId, logType, notes, createdBy: createdBy ?? null } });
  }

  async apiLog(providerId: bigint | null, appId: number | null, logType: string, notes: string) {
    await this.prisma.apiLog.create({ data: { providerId, appId, logType, notes } });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
