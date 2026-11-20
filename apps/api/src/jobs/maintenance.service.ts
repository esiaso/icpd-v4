import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { spawn } from 'child_process';
import { ListObjectsV2Command, DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../common/config';
import { StorageService } from '../storage/storage.service';
import { JobsService } from './jobs.service';

/**
 * Weekly DB backup to object storage (Sunday 21:00 Nairobi) and pruning (Sunday 15:00), spec 8.
 * Needs `pg_dump` on the API host/container.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly logger = new Logger('Maintenance');
  constructor(private readonly jobs: JobsService, private readonly storage: StorageService) {}

  onModuleInit() {
    this.jobs.register('maintenance.backup', () => this.backup());
    this.jobs.register('maintenance.prune-backups', () => this.prune());
    this.jobs.schedule('maintenance.backup', '0 21 * * 0');
    this.jobs.schedule('maintenance.prune-backups', '0 15 * * 0');
  }

  async backup() {
    const dump = await new Promise<Buffer>((resolve, reject) => {
      const url = (process.env.DATABASE_URL ?? '').replace(/\?.*$/, '');
      const p = spawn('pg_dump', ['--format=custom', '--no-owner', url]);
      const chunks: Buffer[] = [];
      p.stdout.on('data', (c) => chunks.push(c));
      p.stderr.on('data', (d) => this.logger.warn(String(d)));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`pg_dump exited ${code}`))));
    });
    const key = `db/icpd-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`;
    await this.storage.putRaw(key, dump, 'application/octet-stream', config.backupBucket);
    return { key, bytes: dump.length };
  }

  /** Keep the newest 8 weekly backups. */
  async prune(keep = 8) {
    if (config.disableQueues) return { deleted: 0 };
    const s3 = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.s3.key, secretAccessKey: config.s3.secret },
    });
    const list = await s3.send(new ListObjectsV2Command({ Bucket: config.backupBucket, Prefix: 'db/' }));
    const objects = (list.Contents ?? []).sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));
    const old = objects.slice(keep);
    if (old.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: config.backupBucket, Delete: { Objects: old.map((o) => ({ Key: o.Key! })) } }));
    }
    return { deleted: old.length };
  }
}

@Module({ providers: [MaintenanceService] })
export class MaintenanceModule {}
