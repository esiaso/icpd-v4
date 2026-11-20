import { Global, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { config } from '../common/config';
import { PrismaService } from '../common/prisma.service';
import { redisConnection } from './redis';

export type JobHandler = (data: any, progress: (done: number, total: number) => Promise<void>) => Promise<unknown>;

interface Schedule {
  name: string;
  pattern: string;
}

/**
 * Background jobs on BullMQ. Modules register named handlers; `enqueue` tracks progress in
 * job_runs so the UI can poll it. Cron schedules use Africa/Nairobi.
 * With DISABLE_QUEUES=true (tests) jobs run inline.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, JobHandler>();
  private readonly schedules: Schedule[] = [];
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly prisma: PrismaService) {}

  register(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  /** Cron pattern in Africa/Nairobi time. */
  schedule(name: string, pattern: string) {
    this.schedules.push({ name, pattern });
  }

  async onApplicationBootstrap() {
    if (config.disableQueues || process.env.RUN_WORKERS === 'false') return;
    this.queue = new Queue('background', { connection: redisConnection() });
    this.worker = new Worker('background', (job) => this.process(job), { connection: redisConnection(), concurrency: 2 });
    this.worker.on('failed', (j, e) => this.logger.error(`${j?.name} failed: ${e.message}`));
    for (const s of this.schedules) {
      await this.queue.upsertJobScheduler(`cron:${s.name}`, { pattern: s.pattern, tz: 'Africa/Nairobi' }, { name: s.name, data: {} });
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Queue a job and return its job_runs id for progress polling. */
  async enqueue(name: string, data: Record<string, unknown>, createdBy?: bigint | null) {
    const run = await this.prisma.jobRun.create({ data: { name, createdBy: createdBy ?? null } });
    const payload = { ...data, runId: run.id.toString() };
    if (!this.queue) {
      await this.process({ name, data: payload } as Job);
    } else {
      await this.queue.add(name, payload, { removeOnComplete: 500, removeOnFail: 500 });
    }
    return this.prisma.jobRun.findUniqueOrThrow({ where: { id: run.id } });
  }

  async run(name: string, data: Record<string, unknown> = {}) {
    return this.process({ name, data } as Job);
  }

  private async process(job: Pick<Job, 'name' | 'data'>) {
    const handler = this.handlers.get(job.name);
    if (!handler) throw new Error(`No handler for job ${job.name}`);
    const runId = job.data?.runId ? BigInt(job.data.runId) : null;
    if (runId) await this.prisma.jobRun.update({ where: { id: runId }, data: { status: 'running' } });
    try {
      const result = await handler(job.data, async (done, total) => {
        if (runId) await this.prisma.jobRun.update({ where: { id: runId }, data: { progress: done, total } });
      });
      if (runId) {
        await this.prisma.jobRun.update({
          where: { id: runId },
          data: { status: 'done', finishedAt: new Date(), result: JSON.parse(JSON.stringify(result ?? null, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) },
        });
      }
      return result;
    } catch (e: any) {
      if (runId) await this.prisma.jobRun.update({ where: { id: runId }, data: { status: 'failed', error: String(e?.message ?? e), finishedAt: new Date() } });
      throw e;
    }
  }

  get(runId: bigint) {
    return this.prisma.jobRun.findUnique({ where: { id: runId } });
  }
}

@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
