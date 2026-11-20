import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IdentityService } from './identity.service';
import { RecaptchaService } from './recaptcha.service';
import { PasswordConfirmedGuard } from './confirm.guard';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, IdentityService, RecaptchaService, PasswordConfirmedGuard],
  exports: [AuthService, IdentityService, RecaptchaService, PasswordConfirmedGuard, JwtModule],
})
export class AuthModule {}
