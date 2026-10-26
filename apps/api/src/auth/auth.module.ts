import { Global, Module } from '@nestjs/common';
import { SupabaseJwtService } from './supabase-jwt.service.js';

@Global()
@Module({
  providers: [SupabaseJwtService],
  exports: [SupabaseJwtService],
})
export class AuthModule {}
