import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './common/config';

// JSON-serialise BigInt ids as strings.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  const http = app.getHttpAdapter().getInstance();
  http.set('trust proxy', 1);

  const doc = new DocumentBuilder()
    .setTitle('ICPD v4 API')
    .setDescription(
      'Internal API for the ICPD web app (cookie session + CSRF header) and the public v1 API for provider systems ' +
        '(header `api-consumer: base64(key:secret)`). Errors use `{ error: { code, message, details } }`.',
    )
    .setVersion('4.0.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'api-consumer' }, 'api-consumer')
    .addCookieAuth('icpd_at')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  return app;
}

export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: config.isTest ? ['error'] : undefined });
  configureApp(app);
  return app;
}
