import { CanActivate, ExecutionContext, Injectable, UseGuards, applyDecorators } from '@nestjs/common';
import { AppError } from '../common/errors';
import { AuthService } from './auth.service';
import { CONFIRM_COOKIE } from './auth.controller';

/** Sensitive actions need a password confirmation in the last 3 hours (Laravel password.confirm). */
@Injectable()
export class PasswordConfirmedGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    if (!req.user) return false;
    if (await this.auth.isRecentlyConfirmed(req.user.id, req.cookies?.[CONFIRM_COOKIE])) return true;
    throw new AppError('PASSWORD_CONFIRMATION_REQUIRED', 'Please confirm your password to continue', 423);
  }
}

export const RequirePasswordConfirm = () => applyDecorators(UseGuards(PasswordConfirmedGuard));
