-- Phase 10: Sperre eines Händlerkontos für Deals als begründete, anfechtbare Entscheidung (Art. 17/20 DSA).
-- Nur neue Enum-Werte, keine Datenänderung.
ALTER TYPE "ModerationAction" ADD VALUE 'DEALS_BLOCKED';
ALTER TYPE "ModerationAction" ADD VALUE 'DEALS_UNBLOCKED';
ALTER TYPE "NotificationType" ADD VALUE 'DEALS_BLOCKED';
ALTER TYPE "NotificationType" ADD VALUE 'DEALS_UNBLOCKED';
