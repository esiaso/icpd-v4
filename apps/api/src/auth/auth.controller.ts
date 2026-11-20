import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@icpd/shared';
import { Z } from '../common/zod';
import { config } from '../common/config';
import { CurrentUser, Public, type AuthUser } from '../common/auth.decorators';
import { AuthService, type SessionTokens } from './auth.service';
import { RecaptchaService } from './recaptcha.service';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from './guards';
import { serializeMe } from './me';
import { IdentityService } from './identity.service';

export const CONFIRM_COOKIE = 'icpd_pc';

export function clientOf(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

export function setSessionCookies(res: Response, t: SessionTokens) {
  const secure = config.isProd;
  res.cookie(ACCESS_COOKIE, t.accessToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: config.accessTtlSeconds * 1000 });
  res.cookie(REFRESH_COOKIE, t.refreshToken, { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth', maxAge: config.refreshTtlSeconds * 1000 });
  res.cookie(CSRF_COOKIE, t.csrfToken, { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge: config.refreshTtlSeconds * 1000 });
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
  res.clearCookie(CONFIRM_COOKIE, { path: '/' });
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly recaptcha: RecaptchaService,
    private readonly identity: IdentityService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(@Body(Z(registerSchema)) body: z.infer<typeof registerSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.recaptcha.check(body, req.ip);
    const user = await this.auth.register(body);
    setSessionCookies(res, await this.auth.startSession(user.id, clientOf(req)));
    return serializeMe(await this.identity.load(user.id));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(Z(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validateCredentials(body.email, body.password, clientOf(req));
    setSessionCookies(res, await this.auth.startSession(user.id, clientOf(req)));
    return serializeMe(await this.identity.load(user.id));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const t = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], clientOf(req));
      setSessionCookies(res, t);
      return { ok: true };
    } catch (e) {
      clearSessionCookies(res);
      throw e;
    }
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request & { user?: AuthUser }, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], req.user?.id);
    clearSessionCookies(res);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return serializeMe(user);
  }

  @Public()
  @HttpCode(200)
  @Post('verify-email')
  async verify(@Body(Z(z.object({ token: z.string().min(10) }))) body: { token: string }) {
    await this.auth.verifyEmail(body.token);
    return { ok: true, message: 'Your email address has been verified.' };
  }

  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @HttpCode(200)
  @Post('verify-email/resend')
  async resend(@CurrentUser() user: AuthUser) {
    await this.auth.sendVerification(user.id);
    return { ok: true, message: 'A new verification link has been sent to your email address.' };
  }

  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  async forgot(@Body(Z(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>, @Req() req: Request) {
    await this.recaptcha.check(body, req.ip);
    await this.auth.forgotPassword(body.email);
    return { ok: true, message: 'If that email is registered, we have emailed a password reset link.' };
  }

  @Public()
  @HttpCode(200)
  @Post('reset-password')
  async reset(@Body(Z(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>) {
    await this.auth.resetPassword(body.token, body.password);
    return { ok: true, message: 'Your password has been reset.' };
  }

  @HttpCode(200)
  @Post('change-password')
  async change(@CurrentUser() user: AuthUser, @Body(Z(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(user.id, body.currentPassword, body.password);
    return { ok: true, message: 'Password updated.' };
  }

  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @HttpCode(200)
  @Post('confirm-password')
  async confirm(@CurrentUser() user: AuthUser, @Body(Z(z.object({ password: z.string().min(1) }))) body: { password: string }, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.confirmPassword(user.id, body.password);
    res.cookie(CONFIRM_COOKIE, t, { httpOnly: true, secure: config.isProd, sameSite: 'strict', path: '/', maxAge: 3 * 60 * 60 * 1000 });
    return { ok: true };
  }
}
