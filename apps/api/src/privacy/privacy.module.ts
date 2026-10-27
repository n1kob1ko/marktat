import { Module } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service.js';
import { DataExportService } from './data-export.service.js';
import { PrivacyController } from './privacy.controller.js';
import { RetentionService } from './retention.service.js';
import { SupabaseAdminClient } from './supabase-admin.client.js';

@Module({
  controllers: [PrivacyController],
  providers: [SupabaseAdminClient, DataExportService, AccountDeletionService, RetentionService],
  exports: [AccountDeletionService, RetentionService, SupabaseAdminClient],
})
export class PrivacyModule {}
