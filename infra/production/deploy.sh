#!/usr/bin/env bash
# MarktAT – Deployment auf dem Server (Docker Compose). Anleitung: docs/deployment.md
#
#   deploy.sh check                 Konfiguration prüfen (ändert nichts)
#   deploy.sh build-args            öffentliche Werte für den Bau des Web-Images ausgeben (keine Geheimnisse)
#   deploy.sh deploy <image-tag>    neue Version: Sicherung → Migrationen → Start → Healthchecks;
#                                   schlägt der Start fehl, läuft automatisch wieder die vorige Version
#   deploy.sh rollback              zurück zur vorigen Version (ohne Migrationen, siehe docs/deployment.md)
#   deploy.sh status                laufende Version, Container, Healthchecks
#   deploy.sh compose <befehl …>    docker compose für die laufende Version, z. B. `compose logs -f api` oder
#                                   `compose exec api pnpm admin:role -- --email … --role ADMIN`
#
# Aufbau auf dem Server (MARKTAT_ROOT, Standard /opt/marktat):
#   .env                     Umgebung (nur hier, Rechte 600)
#   releases/<tag>/          Konfiguration je Version (dieses Skript, compose.yml, Caddyfile, …)
#   current → releases/<tag> laufende Version; state/previous = Version davor
#   access/                  von hier erzeugter Zugangsschutz für Caddy
#   backups/                 verschlüsselte Datenbanksicherungen (backup.sh)
#   deploy.log               Protokoll aller Deployments
set -Eeuo pipefail

RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${MARKTAT_ROOT:-/opt/marktat}"
ENV_FILE="$ROOT/.env"
STATE="$ROOT/state"
LOG="$ROOT/deploy.log"
KEEP_RELEASES=4

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG" >&2; }
die() { log "FEHLER: $*"; exit 1; }

# Wert aus der .env lesen (letzte Zeile gewinnt, Anführungszeichen entfernt) – ohne die Datei als Shell auszuführen
env_get() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "$line"
}

compose() {
  local dir="${COMPOSE_DIR:-$RELEASE_DIR}" extra=()
  # Nur für die lokale Generalprobe (probe/compose.probe.yml), auf dem Server leer
  [ -n "${MARKTAT_COMPOSE_OVERRIDE:-}" ] && extra=(-f "$dir/$MARKTAT_COMPOSE_OVERRIDE")
  docker compose --project-directory "$dir" -f "$dir/compose.yml" "${extra[@]}" --env-file "$ENV_FILE" "$@"
}

prepare_release() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE fehlt (Vorlage: env.production.example)"
  [ "$(stat -c %a "$ENV_FILE")" = "600" ] || chmod 600 "$ENV_FILE"
  mkdir -p "$STATE" "$ROOT/access" "$ROOT/backups"
  # Gemeinsame Dateien in die Version verlinken (compose.yml erwartet sie relativ zu sich)
  ln -sfn "$ENV_FILE" "$RELEASE_DIR/.env"
  ln -sfn "$ROOT/access" "$RELEASE_DIR/access"
  write_access_rules
}

# Optionaler HTTP-Basic-Auth-Schutz der Web-App aus BETA_BASIC_AUTH=benutzer:passwort (Passwort nur als bcrypt-Hash)
write_access_rules() {
  local auth user password hash
  auth="$(env_get BETA_BASIC_AUTH)"
  rm -f "$ROOT/access/"*.caddy
  if [ -z "$auth" ]; then
    echo '# Kein Zugangsschutz (BETA_BASIC_AUTH ist leer)' > "$ROOT/access/00-open.caddy"
    return
  fi
  user="${auth%%:*}"
  password="${auth#*:}"
  [ -n "$user" ] && [ -n "$password" ] && [ "$user" != "$auth" ] || die 'BETA_BASIC_AUTH braucht das Format benutzer:passwort'
  [[ "$user" =~ ^[A-Za-z0-9._-]+$ ]] || die 'BETA_BASIC_AUTH: Benutzername nur aus Buchstaben, Ziffern, . _ -'
  hash="$(docker run --rm caddy:2.10-alpine caddy hash-password --plaintext "$password")"
  printf 'basic_auth {\n\t%s %s\n}\n' "$user" "$hash" > "$ROOT/access/10-basic-auth.caddy"
}

check() {
  export IMAGE_TAG="${IMAGE_TAG:-$(cat "$STATE/current" 2>/dev/null || true)}"
  [ -n "$IMAGE_TAG" ] || die 'Noch keine Version installiert: IMAGE_TAG=<tag> deploy.sh check'
  prepare_release
  compose config --quiet || die 'compose.yml oder .env ungültig'
  compose run --rm --no-deps -T tools pnpm --silent env:check || die 'Umgebung ist nicht bereit (siehe oben)'
}

curl_opts() {
  local opts=(-fsS --max-time 10 --retry 12 --retry-delay 5 --retry-all-errors)
  # Probe mit lokalen Zertifikaten (CADDY_GLOBAL_EXTRA=local_certs): Zertifikat ist nicht öffentlich vertrauenswürdig
  [[ "$(env_get CADDY_GLOBAL_EXTRA)" == *local_certs* ]] && opts+=(-k)
  printf '%s\n' "${opts[@]}"
}

smoke_test() {
  local web api auth
  web="$(env_get WEB_DOMAIN)"; api="$(env_get API_DOMAIN)"; auth="$(env_get BETA_BASIC_AUTH)"
  mapfile -t opts < <(curl_opts)
  local web_auth=()
  [ -n "$auth" ] && web_auth=(-u "$auth")
  # Über Caddy und HTTPS, wie aus dem Internet (aufgelöst auf diesen Server)
  curl "${opts[@]}" --resolve "$api:443:127.0.0.1" "https://$api/v1/health/ready" > /dev/null || return 1
  curl "${opts[@]}" --resolve "$api:443:127.0.0.1" "https://$api/auth/v1/health" > /dev/null || return 1
  curl "${opts[@]}" --resolve "$web:443:127.0.0.1" "${web_auth[@]}" "https://$web/" > /dev/null || return 1
}

start_stack() {
  compose up -d --remove-orphans --wait --wait-timeout 240
}

deploy() {
  local tag="${1:?Aufruf: deploy.sh deploy <image-tag>}" previous previous_dir
  [[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]] || die "ungültiger Image-Tag: $tag"
  exec 9> "$ROOT/.deploy.lock"
  flock -n 9 || die 'Es läuft bereits ein Deployment.'
  export IMAGE_TAG="$tag"
  previous="$(cat "$STATE/current" 2>/dev/null || true)"
  log "Deployment $tag gestartet (bisher: ${previous:-keine})"

  prepare_release
  # Generalprobe mit lokal gebauten Images: MARKTAT_SKIP_PULL=1
  [ -n "${MARKTAT_SKIP_PULL:-}" ] || compose pull --quiet --policy always api web
  compose pull --quiet --policy missing
  check

  # Sicherung vor Migrationen – nur wenn schon eine Datenbank läuft (nicht beim allerersten Start)
  if [ -n "$previous" ]; then
    "$RELEASE_DIR/backup.sh" pre-deploy || die 'Sicherung fehlgeschlagen – nichts verändert.'
  fi

  compose up -d --wait --wait-timeout 180 db redis meilisearch
  log 'Migrationen …'
  compose run --rm --no-deps -T tools pnpm db:migrate || die 'Migration fehlgeschlagen – die bisherige Version läuft weiter. Sicherung: backups/'
  # Kategorien, Pflichtfelder, Produkte (idempotent; Demo-Inserate sind in Produktion gesperrt)
  compose run --rm --no-deps -T tools pnpm db:seed || die 'Grunddaten fehlgeschlagen – die bisherige Version läuft weiter.'

  log 'Start der neuen Version …'
  if start_stack && smoke_test; then
    [ -n "$previous" ] && [ "$previous" != "$tag" ] && echo "$previous" > "$STATE/previous"
    echo "$tag" > "$STATE/current"
    ln -sfn "$RELEASE_DIR" "$ROOT/current"
    cleanup_releases
    log "Deployment $tag erfolgreich."
    return 0
  fi

  log "Neue Version $tag startet nicht sauber."
  compose ps >&2 || true
  compose logs --tail 80 api web auth caddy >&2 || true
  previous_dir="$ROOT/releases/$previous"
  if [ -n "$previous" ] && [ -d "$previous_dir" ]; then
    log "Automatisches Zurückrollen auf $previous …"
    if IMAGE_TAG="$previous" COMPOSE_DIR="$previous_dir" compose up -d --remove-orphans --wait --wait-timeout 240; then
      log "Version $previous läuft wieder."
    else
      log "Zurückrollen fehlgeschlagen – bitte docs/deployment.md, Abschnitt Notfall."
    fi
  fi
  die "Deployment $tag fehlgeschlagen."
}

rollback() {
  local target dir
  target="$(cat "$STATE/previous" 2>/dev/null || true)"
  [ -n "$target" ] || die 'Keine vorige Version bekannt.'
  dir="$ROOT/releases/$target"
  [ -d "$dir" ] || die "Konfiguration der Version $target fehlt ($dir)."
  exec 9> "$ROOT/.deploy.lock"
  flock -n 9 || die 'Es läuft bereits ein Deployment.'
  log "Zurückrollen auf $target (Datenbank bleibt auf dem neuen Stand; Migrationen sind abwärtskompatibel angelegt)"
  IMAGE_TAG="$target" COMPOSE_DIR="$dir" compose up -d --remove-orphans --wait --wait-timeout 240 || die 'Zurückrollen fehlgeschlagen.'
  cat "$STATE/current" > "$STATE/previous"
  echo "$target" > "$STATE/current"
  ln -sfn "$dir" "$ROOT/current"
  log "Version $target läuft."
}

status() {
  echo "Laufende Version: $(cat "$STATE/current" 2>/dev/null || echo –)   vorige: $(cat "$STATE/previous" 2>/dev/null || echo –)"
  IMAGE_TAG="$(cat "$STATE/current" 2>/dev/null || echo none)" COMPOSE_DIR="$ROOT/current" compose ps
  smoke_test && echo 'Healthchecks über HTTPS: ok' || echo 'Healthchecks über HTTPS: FEHLER'
}

# Alte Versionen (Konfiguration und Images) entfernen; laufende und vorige bleiben immer
cleanup_releases() {
  local current previous old api_image web_image
  current="$(cat "$STATE/current" 2>/dev/null || true)"
  previous="$(cat "$STATE/previous" 2>/dev/null || true)"
  api_image="$(env_get API_IMAGE)"; web_image="$(env_get WEB_IMAGE)"
  for old in $(ls -1t "$ROOT/releases" | tail -n +"$((KEEP_RELEASES + 1))"); do
    if [ "$old" = "$current" ] || [ "$old" = "$previous" ]; then continue; fi
    rm -rf "${ROOT:?}/releases/$old"
    docker image rm "${api_image:-ghcr.io/n1kob1ko/marktat-api}:$old" "${web_image:-ghcr.io/n1kob1ko/marktat-web}:$old" \
      > /dev/null 2>&1 || true
  done
}

build_args() {
  local key
  for key in WEB_DOMAIN API_DOMAIN SUPABASE_ANON_KEY R2_ACCOUNT_ID R2_JURISDICTION R2_ENDPOINT; do
    printf '%s=%s\n' "$key" "$(env_get "$key")"
  done
}

case "${1:-}" in
  check) check; echo 'Konfiguration in Ordnung.' ;;
  build-args) build_args ;;
  deploy) deploy "${2:-}" ;;
  rollback) rollback ;;
  status) status ;;
  compose)
    shift
    IMAGE_TAG="$(cat "$STATE/current" 2>/dev/null || true)" COMPOSE_DIR="$ROOT/current" compose "$@"
    ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
