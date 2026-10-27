-- Phase 8: Fehlerübersicht (nur neue Tabelle, bestehende Daten bleiben unberührt)
CREATE TABLE "error_events" (
    "id" BIGSERIAL NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "error_name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "error_events_fingerprint_key" ON "error_events"("fingerprint");
CREATE INDEX "error_events_last_seen_at_idx" ON "error_events"("last_seen_at");
