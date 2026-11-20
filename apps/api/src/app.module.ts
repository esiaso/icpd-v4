import { Controller, Get, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConsumerThrottlerGuard } from './public-api/api-consumer.guard';
import { PrismaModule, PrismaService } from './common/prisma.service';
import { ErrorEnvelopeFilter } from './common/errors';
import { RequestLogMiddleware } from './common/request-log.middleware';
import { Public } from './common/auth.decorators';
import { AuditModule } from './audit/audit.service';
import { MailModule } from './mail/mail.service';
import { StorageModule } from './storage/storage.service';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/guards';
import { UsersController } from './users/users.controller';
import { FEATURE_MODULES } from './features';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }], skipIf: () => process.env.NODE_ENV === 'test' && !process.env.TEST_THROTTLE }),
    PrismaModule,
    AuditModule,
    MailModule,
    StorageModule,
    AuthModule,
    ...FEATURE_MODULES,
  ],
  controllers: [HealthController, UsersController],
  providers: [
    { provide: APP_GUARD, useClass: ConsumerThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLogMiddleware).forRoutes('*');
  }
}
