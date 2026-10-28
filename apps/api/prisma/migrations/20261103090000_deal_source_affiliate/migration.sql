-- Zentrale Affiliate-Deals (Awin): eigene Herkunft. Eigene Migration, weil ein neuer Enum-Wert in PostgreSQL erst
-- nach dem Commit verwendet werden darf (die CHECK-Bedingung in der nächsten Migration nutzt ihn).
ALTER TYPE "DealSource" ADD VALUE 'AFFILIATE';
