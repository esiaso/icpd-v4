import { Global, Injectable, Module } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { config } from '../common/config';
import { BadRequest } from '../common/errors';

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

const KINDS = {
  pdf: { mimes: ['application/pdf'], magic: [Buffer.from('%PDF')] },
  image: {
    mimes: ['image/jpeg', 'image/png', 'image/webp'],
    magic: [Buffer.from([0xff, 0xd8, 0xff]), Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('RIFF')],
  },
  excel: {
    mimes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
    ],
    magic: [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],
  },
  any: { mimes: [] as string[], magic: [] as Buffer[] },
};
export type FileKind = keyof typeof KINDS;

/**
 * S3-compatible object storage (DigitalOcean Spaces / MinIO). Objects are private; clients get
 * short-lived signed URLs. Stored values are object keys, not public URLs.
 */
@Injectable()
export class StorageService {
  private client = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.s3.key, secretAccessKey: config.s3.secret },
  });
  /** In-memory store for tests (DISABLE_QUEUES doubles as "no external services"). */
  private readonly memory = new Map<string, Buffer>();

  validate(file: UploadedFile | undefined, kind: FileKind, maxBytes = config.maxUploadBytes): UploadedFile {
    if (!file) throw BadRequest('A file is required');
    if (file.size > maxBytes) throw BadRequest(`File is too large (max ${Math.round(maxBytes / 1048576)} MB)`);
    const k = KINDS[kind];
    if (k.mimes.length && !k.mimes.includes(file.mimetype)) throw BadRequest(`Unsupported file type ${file.mimetype}`);
    if (k.magic.length && !k.magic.some((m) => file.buffer.subarray(0, m.length).equals(m))) {
      throw BadRequest('File content does not match its type');
    }
    return file;
  }

  async put(prefix: string, file: UploadedFile, bucket = config.s3.bucket): Promise<string> {
    const ext = (file.originalname.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `${prefix}/${new Date().getUTCFullYear()}/${randomUUID()}.${ext}`;
    await this.putRaw(key, file.buffer, file.mimetype, bucket);
    return key;
  }

  async putRaw(key: string, body: Buffer, contentType: string, bucket = config.s3.bucket) {
    if (config.disableQueues) {
      this.memory.set(`${bucket}/${key}`, body);
      return key;
    }
    await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    return key;
  }

  async signedUrl(key: string | null | undefined, ttlSeconds = 600, bucket = config.s3.bucket): Promise<string | null> {
    if (!key) return null;
    if (/^https?:\/\//.test(key)) return key;
    if (config.disableQueues) return `memory://${bucket}/${key}`;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttlSeconds });
  }

  async get(key: string, bucket = config.s3.bucket): Promise<Buffer> {
    if (config.disableQueues) return this.memory.get(`${bucket}/${key}`) ?? Buffer.alloc(0);
    const r = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async remove(key: string, bucket = config.s3.bucket) {
    if (config.disableQueues) return void this.memory.delete(`${bucket}/${key}`);
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
