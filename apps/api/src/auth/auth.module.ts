import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IdentityService } from './identity.service';
import { RecaptchaService } from './recaptcha.service';
import { PasswordConfirmedGuard } from './confirm.guard';
import { LegacyAuthController } from './legacy-auth.controller';
import { LegacyAuthService } from './legacy-auth.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, LegacyAuthController],
  providers: [AuthService, IdentityService, RecaptchaService, PasswordConfirmedGuard, LegacyAuthService],
  exports: [AuthService, IdentityService, RecaptchaService, PasswordConfirmedGuard, JwtModule],
})
export class AuthModule {}
