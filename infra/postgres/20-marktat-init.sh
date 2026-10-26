#!/bin/sh
# Legt beim ersten Start die Datenbanken für App, Tests und Supabase Auth an.
# Läuft nach dem PostGIS-Init-Skript des Images (Dateien werden alphabetisch ausgeführt).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
  CREATE DATABASE marktat_test;
  CREATE DATABASE marktat_auth;
SQL

for db in marktat marktat_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-SQL
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
done

# Supabase Auth erwartet diese Rollen (in Supabase-Projekten sind sie vorhanden).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname marktat_auth <<-SQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres NOLOGIN; END IF;
  END
  \$\$;
  CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION "$POSTGRES_USER";
SQL
