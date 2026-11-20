import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { safeEqualHex, sha256 } from '../common/crypto';

export interface ApiConsumer {
  appId: number;
  providerId: bigint | null;
  isCouncil: boolean;
  name: string;
}

export const COUNCIL_ONLY = 'councilOnly';
export const CouncilOnly = () => SetMetadata(COUNCIL_ONLY, true);

/** Decode `api-consumer: base64(key:secret)`. */
export function parseConsumerHeader(h: unknown): { key: string; secret: string } | null {
  if (typeof h !== 'string' || !h) return null;
  try {
    const decoded = Buffer.from(h.trim(), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i < 1) return null;
    return { key: decoded.slice(0, i), secret: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}

/**
 * API consumer authentication (spec 7, defect #2): hashed secret compared in constant time,
 * app must be ACTIVE, providerId comes from the app (never the request body). 401/403 errors.
 */
@Injectable()
export class ApiConsumerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const creds = parseConsumerHeader(req.headers['api-consumer']);
    if (!creds) throw new AppError('UNAUTHORIZED', 'Missing or malformed api-consumer header', 401);
    const app = await this.prisma.apiConsumerApp.findFirst({ where: { key: creds.key, deletedAt: null } });
    // Hash even when the app is unknown so timing doesn't reveal valid keys.
    const presented = sha256(creds.secret);
    const ok = !!app?.secretHash && safeEqualHex(presented, app.secretHash);
    if (!app || !ok) throw new AppError('UNAUTHORIZED', 'Invalid API credentials', 401);
    if (app.status !== 'ACTIVE') throw new AppError('FORBIDDEN', `This application is ${app.status.toLowerCase()}`, 403);
    const councilOnly = this.reflector.getAllAndOverride<boolean>(COUNCIL_ONLY, [ctx.getHandler(), ctx.getClass()]);
    if (councilOnly && !app.isCouncil) throw new AppError('FORBIDDEN', 'This endpoint needs a council credential', 403);
    if (!councilOnly && app.isCouncil) throw new AppError('FORBIDDEN', 'Council credentials may only read the council diary', 403);
    if (!councilOnly && !app.providerId) throw new AppError('FORBIDDEN', 'This application is not linked to a provider', 403);
    req.apiConsumer = { appId: app.id, providerId: app.providerId, isCouncil: app.isCouncil, name: app.name } satisfies ApiConsumer;
    return true;
  }
}

/** Rate limits per API consumer key (falls back to IP for everyone else). */
@Injectable()
export class ConsumerThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const creds = parseConsumerHeader(req.headers?.['api-consumer']);
    return creds ? `consumer:${creds.key}` : req.ip;
  }
}
