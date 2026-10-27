#!/usr/bin/env bash
# Generalprobe des Online-Betriebs auf einem Entwicklungsrechner: echter deploy.sh-Ablauf mit den Produktions-Images,
# HTTPS über Caddy (lokale Zertifikate), Mailpit statt Versanddienst, S3-Ersatz statt R2. Keine echten Daten.
#
#   infra/production/probe/probe.sh <arbeitsordner> [image-tag]
#
# Vorher die Images bauen (Tag Standard: probe), Web mit den Probe-Adressen:
#   docker build -f apps/api/Dockerfile -t marktat-api:probe .
#   docker build -f apps/web/Dockerfile -t marktat-web:probe --build-arg WEB_URL=https://marktat.localhost \
#     --build-arg API_URL=https://api.marktat.localhost --build-arg SUPABASE_URL=https://api.marktat.localhost \
#     --build-arg SUPABASE_ANON_KEY=<aus <arbeitsordner>/.env> --build-arg R2_ENDPOINT=https://s3.marktat.localhost .
# (Der Anon-Key entsteht beim ersten Aufruf; probe.sh bricht dann mit einem Hinweis ab, falls das Web-Image fehlt.)
#
# Danach: Browser-Tests gegen https://marktat.localhost (docs/deployment.md, Abschnitt Generalprobe).
# Aufräumen: docker compose -p marktat-probe down -v
set -Eeuo pipefail

WORK="$(mkdir -p "${1:?Aufruf: probe.sh <arbeitsordner> [image-tag]}" && cd "$1" && pwd)"
TAG="${2:-probe}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD="$(dirname "$HERE")"
REL="$WORK/releases/$TAG"

if [ ! -f "$WORK/.env" ]; then
  cp "$PROD/env.production.example" "$WORK/.env"
  node "$PROD/generate-secrets.mjs" "$WORK/.env"
  cat >> "$WORK/.env" <<ENV

# --- Generalprobe (überschreibt die Werte oben) ---
COMPOSE_PROJECT_NAME=marktat-probe
WEB_DOMAIN=marktat.localhost
API_DOMAIN=api.marktat.localhost
ACME_EMAIL=probe@example.org
CADDY_GLOBAL_EXTRA=local_certs
API_IMAGE=marktat-api
WEB_IMAGE=marktat-web
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USER=probe
SMTP_PASSWORD=probe
MAIL_FROM="MarktAT <noreply@probe.marktat.test>"
MAIL_FROM_ADDRESS=noreply@probe.marktat.test
R2_ACCESS_KEY_ID=S3RVER
R2_SECRET_ACCESS_KEY=S3RVER
R2_ENDPOINT=https://s3.marktat.localhost
MESSAGE_EMAIL_DELAY_SECONDS=0
ENV
  echo "Neue Probe-Umgebung: $WORK/.env"
fi

rm -rf "$REL" && mkdir -p "$REL/probe/ca"
cp "$PROD"/{compose.yml,Caddyfile,postgres-init.sh,deploy.sh,backup.sh} "$REL/"
cp "$HERE"/{compose.probe.yml,Caddyfile.probe,s3-cors.xml} "$REL/probe/"
cp -r "$PROD/../email-templates" "$REL/email-templates"
[ -f "$WORK/ca/root.crt" ] && cp "$WORK/ca/root.crt" "$REL/probe/ca/" && chmod 755 "$REL/probe/ca" && chmod 644 "$REL/probe/ca/root.crt"

docker image inspect "marktat-web:$TAG" > /dev/null 2>&1 \
  || { echo "Image marktat-web:$TAG fehlt – bauen mit SUPABASE_ANON_KEY=$(grep ^SUPABASE_ANON_KEY= "$WORK/.env" | tail -n1 | cut -d= -f2-)"; exit 1; }

# Shell-Variablen gingen sonst den Werten aus der .env vor
unset NODE_EXTRA_CA_CERTS
export MARKTAT_ROOT="$WORK" MARKTAT_COMPOSE_OVERRIDE=probe/compose.probe.yml MARKTAT_SKIP_PULL=1 COMPOSE_PROJECT_NAME=marktat-probe
"$REL/deploy.sh" deploy "$TAG"

# Lokale CA von Caddy für Web und API (Server-zu-Server über HTTPS); danach neu starten (Caddy, weil probe.sh den
# Versionsordner unter gleichem Namen neu anlegt und Caddy sonst noch den alten, gelöschten Ordner eingebunden hätte)
mkdir -p "$WORK/ca"
docker compose -p marktat-probe cp caddy:/data/caddy/pki/authorities/local/root.crt "$WORK/ca/root.crt"
cp "$WORK/ca/root.crt" "$REL/probe/ca/root.crt"
# Web und API laufen als Benutzer node: Zertifikat (öffentlich, kein Schlüssel) lesbar machen
chmod 755 "$REL/probe/ca" && chmod 644 "$REL/probe/ca/root.crt"
IMAGE_TAG="$TAG" docker compose --project-directory "$REL" -f "$REL/compose.yml" -f "$REL/probe/compose.probe.yml" \
  --env-file "$WORK/.env" up -d --wait --force-recreate web api caddy
echo "Generalprobe läuft: https://marktat.localhost  (Mailpit: http://127.0.0.1:8026)"
