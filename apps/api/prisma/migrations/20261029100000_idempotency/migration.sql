-- Schutz vor Doppelten bei wiederholtem Abschicken (Doppelklick, Verbindungsabbruch). Nur Ergänzungen.
ALTER TABLE "listings" ADD COLUMN "client_request_id" UUID;
ALTER TABLE "messages" ADD COLUMN "client_id" UUID;

CREATE UNIQUE INDEX "listings_seller_id_client_request_id_key" ON "listings"("seller_id", "client_request_id");
CREATE UNIQUE INDEX "messages_sender_id_client_id_key" ON "messages"("sender_id", "client_id");
