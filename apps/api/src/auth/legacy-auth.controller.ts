import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { config } from '../common/config';
import { randomToken, safeEqualHex } from '../common/crypto';
import { AuthService } from './auth.service';
import { IdentityService } from './identity.service';
import { LegacyAuthService } from './legacy-auth.service';
import { clientOf, setSessionCookies } from './auth.controller';
import { serializeMe } from './me';

const STATE_COOKIE = 'icpd_sso_state';

@ApiTags('auth')
@Public()
@Controller('auth')
export class LegacyAuthController {
  constructor(private readonly legacy: LegacyAuthService, private readonly auth: AuthService, private readonly identity: IdentityService) {}

  /** Pre-2021 account activation with reg. no./email + old password. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('migrate')
  async migrate(@Body(Z(z.object({ identifier: z.string().trim().min(2), password: z.string().min(1) }))) b: { identifier: string; password: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.legacy.migrate(b.identifier, b.password, clientOf(req));
    setSessionCookies(res, await this.auth.startSession(user.id, clientOf(req)));
    return serializeMe(await this.identity.load(user.id));
  }

  /** Start OSP SSO: redirect to the authorization server with a state bound to this browser. */
  @Get('osp/login')
  ospLogin(@Res() res: Response) {
    const state = randomToken(16);
    res.cookie(STATE_COOKIE, state, { httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/api/auth/osp', maxAge: 10 * 60 * 1000 });
    res.redirect(this.legacy.authorizeUrl(state));
  }

  /** Callback: verify state, exchange code, read profile from the SSO server, sign in. */
  @Get('osp/callback')
  async ospCallback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string | undefined, @Req() req: Request, @Res() res: Response) {
    const fail = (reason: string) => res.redirect(`${config.appUrl}/login?sso_error=${encodeURIComponent(reason)}`);
    const expected = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: '/api/auth/osp' });
    if (error) return fail('Sign-in was cancelled.');
    if (!code || !state || !expected || !safeEqualHex(state, expected)) return fail('The sign-in request expired or was tampered with. Please try again.');
    try {
      const profile = await this.legacy.exchange(code);
      const user = await this.legacy.signInFromSso(profile);
      await this.auth.validateSsoLogin(user.id, clientOf(req));
      setSessionCookies(res, await this.auth.startSession(user.id, clientOf(req)));
      res.redirect(`${config.appUrl}/practitioner/portfolio`);
    } catch (e: any) {
      fail(e?.message ?? 'Sign-in failed.');
    }
  }
}
