import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import { config } from '../common/config';
import { renderTemplate, type MailJob, type MailTemplate } from './templates';
import { redisConnection } from '../jobs/redis';

/** Queued email (BullMQ). With DISABLE_QUEUES=true (tests) mails are kept in memory. */
@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Mail');
  private queue?: Queue<MailJob>;
  private worker?: Worker<MailJob>;
  /** Sent/queued mails when queues are disabled; used by tests. */
  readonly outbox: MailJob[] = [];

  private transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: false,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  });

  onModuleInit() {
    if (config.disableQueues) return;
    this.queue = new Queue<MailJob>('mail', { connection: redisConnection() });
    if (process.env.RUN_WORKERS === 'false') return;
    this.worker = new Worker<MailJob>('mail', (job) => this.deliver(job.data), {
      connection: redisConnection(),
      concurrency: 5,
    });
    this.worker.on('failed', (j, e) => this.logger.error(`Mail ${j?.id} failed: ${e.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async send(to: string | null | undefined, template: MailTemplate, data: Record<string, any>) {
    if (!to) return;
    const job: MailJob = { to, template, data };
    if (!this.queue) {
      this.outbox.push(job);
      return;
    }
    await this.queue.add(template, job, { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000 });
  }

  async deliver(job: MailJob) {
    const { subject, mjml } = renderTemplate(job.template, job.data);
    const mjml2html = (await import('mjml')).default as any;
    const out = await mjml2html(mjml, { validationLevel: 'soft' });
    await this.transport.sendMail({ from: config.mail.from, to: job.to, subject, html: out.html });
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
