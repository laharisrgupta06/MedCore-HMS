import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CsrfGuard } from './csrf.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { SessionStore } from './session.store';
import { TokenService } from './token.service';

/** Token, session and guard providers shared by every module. Secrets are passed per call. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [TokenService, SessionStore, JwtAuthGuard, RolesGuard, CsrfGuard],
  exports: [TokenService, SessionStore, JwtAuthGuard, RolesGuard, CsrfGuard],
})
export class AuthCoreModule {}
