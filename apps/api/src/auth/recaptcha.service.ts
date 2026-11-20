import { Injectable } from '@nestjs/common';
import { config } from '../common/config';
import { BadRequest } from '../common/errors';

/** Honeypot + reCAPTCHA check for register, forgot-password and contact. */
@Injectable()
export class RecaptchaService {
  async check(body: { website?: string; recaptchaToken?: string }, ip?: string) {
    if (body.website) throw BadRequest('Invalid submission');
    if (!config.recaptchaSecret) return; // not configured (local/dev/test)
    if (!body.recaptchaToken) throw BadRequest('Please complete the reCAPTCHA');
    const params = new URLSearchParams({ secret: config.recaptchaSecret, response: body.recaptchaToken });
    if (ip) params.set('remoteip', ip);
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body: params });
    const j = (await r.json()) as { success: boolean; score?: number };
    if (!j.success || (j.score !== undefined && j.score < 0.5)) throw BadRequest('reCAPTCHA check failed');
  }
}
