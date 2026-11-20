import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import type { RoleName } from '@icpd/shared';
import { createApp } from '../src/bootstrap';
import { MailService } from '../src/mail/mail.service';

export const prisma = new PrismaClient();
let app: INestApplication | null = null;

export async function getApp() {
  if (!app) {
    app = await createApp();
    await app.init();
  }
  return app;
}

export async function closeApp() {
  await app?.close();
  app = null;
  await prisma.$disconnect();
}

export function outbox() {
  return app!.get(MailService).outbox;
}

let seq = 0;
export function uniq(prefix = 'u') {
  return `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
}

/** A cookie-session client that sends the CSRF header like the web app does. */
export class Client {
  cookies: string[] = [];
  constructor(private readonly app: INestApplication) {}

  private csrf() {
    const c = this.cookies.find((x) => x.startsWith('icpd_csrf='));
    return c ? c.split(';')[0].split('=')[1] : '';
  }

  private store(res: request.Response) {
    const set = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    for (const s of set) {
      const name = s.split('=')[0];
      this.cookies = this.cookies.filter((c) => !c.startsWith(`${name}=`));
      if (!/Expires=Thu, 01 Jan 1970/.test(s)) this.cookies.push(s.split(';')[0]);
    }
    return res;
  }

  private send(method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: any) {
    let r = request(this.app.getHttpServer())[method](`/api${url}`).set('Cookie', this.cookies.join('; '));
    if (method !== 'get') r = r.set('x-csrf-token', this.csrf());
    if (body !== undefined) r = r.send(body);
    return r.then((res) => this.store(res));
  }

  get(url: string) { return this.send('get', url); }
  post(url: string, body?: any) { return this.send('post', url, body ?? {}); }
  put(url: string, body?: any) { return this.send('put', url, body ?? {}); }
  patch(url: string, body?: any) { return this.send('patch', url, body ?? {}); }
  delete(url: string) { return this.send('delete', url); }

  upload(url: string, field: string, file: Buffer, filename: string, fields: Record<string, any> = {}, method: 'post' | 'put' = 'post') {
    let r = request(this.app.getHttpServer())
      [method](`/api${url}`)
      .set('Cookie', this.cookies.join('; '))
      .set('x-csrf-token', this.csrf());
    for (const [k, v] of Object.entries(fields)) r = r.field(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
    return r.attach(field, file, filename).then((res) => this.store(res));
  }

  async login(email: string, password: string) {
    const res = await this.post('/auth/login', { email, password });
    if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
    return this;
  }
}

export const PASSWORD = 'Secret#12345';

export async function makeUser(roles: RoleName[], o: { email?: string; name?: string; verified?: boolean } = {}) {
  const email = o.email ?? `${uniq()}@test.local`;
  const user = await prisma.user.create({
    data: {
      name: o.name ?? 'Test User',
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      emailVerifiedAt: o.verified === false ? null : new Date(),
    },
  });
  for (const r of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: r } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user;
}

export async function loggedIn(roles: RoleName[], o: Parameters<typeof makeUser>[1] = {}) {
  const user = await makeUser(roles, o);
  const client = await new Client(await getApp()).login(user.email, PASSWORD);
  return { user, client };
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
