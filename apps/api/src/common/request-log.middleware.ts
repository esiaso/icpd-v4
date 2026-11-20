import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from './prisma.service';
import { config } from './config';

/** Records method, path, status, latency and actor for every request (replaces LogRequests/LogRoute). */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');
  constructor(private readonly prisma: PrismaService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const user = (req as any).user;
      const consumer = (req as any).apiConsumer;
      if (!config.isTest) this.logger.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
      this.prisma.requestLog
        .create({
          data: {
            method: req.method,
            path: req.originalUrl.split('?')[0].slice(0, 500),
            status: res.statusCode,
            durationMs,
            ip: req.ip,
            userId: user?.id ?? null,
            consumerId: consumer?.appId ?? null,
          },
        })
        .catch(() => undefined);
    });
    next();
  }
}
