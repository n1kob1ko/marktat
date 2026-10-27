import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module.js';
import { MfaService } from './mfa.service.js';
import { SecurityController } from './security.controller.js';

@Module({
  imports: [PrivacyModule],
  controllers: [SecurityController],
  providers: [MfaService],
})
export class SecurityModule {}
