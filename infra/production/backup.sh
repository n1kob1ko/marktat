#!/usr/bin/env bash
# MarktAT – verschlüsselte Datenbanksicherung auf dem Server. Anleitung: docs/deployment.md, Abschnitt Sicherungen
#
#   backup.sh                       tägliche Sicherung (cron): beide Datenbanken, verschlüsselt, alte löschen, optional R2
#   backup.sh pre-deploy            Sicherung vor einem Deployment (von deploy.sh aufgerufen)
#   backup.sh verify <datei.gpg>    entschlüsseln und Inhalt prüfen (ändert nichts)
#   backup.sh restore <datei.gpg>   Datenbank aus einer Sicherung wiederherstellen (überschreibt! fragt nach)
#
# Gesichert werden marktat (App) und marktat_auth (Konten von Supabase Auth) mit pg_dump, verschlüsselt mit gpg
# (AES-256, BACKUP_PASSPHRASE aus der .env). Bilder liegen in R2, der Suchindex lässt sich neu aufbauen
# (pnpm search:reindex), Redis enthält nur kurzlebige Warteschlangen.
set -Eeuo pipefail

ROOT="${MARKTAT_ROOT:-/opt/marktat}"
ENV_FILE="$ROOT/.env"
DIR="$ROOT/backups"
DATABASES=(marktat marktat_auth)

log() { printf '%s backup: %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$ROOT/deploy.log" >&2; }
die() { log "FEHLER: $*"; exit 1; }

env_get() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "$line"
}

compose() {
  local dir="$ROOT/current"
  # Vor dem ersten erfolgreichen Deployment gibt es noch kein current (deploy.sh übergibt dann seine Version)
  [ -n "${RELEASE_DIR:-}" ] && dir="$RELEASE_DIR"
  local extra=()
  [ -n "${MARKTAT_COMPOSE_OVERRIDE:-}" ] && extra=(-f "$dir/$MARKTAT_COMPOSE_OVERRIDE")
  IMAGE_TAG="${IMAGE_TAG:-$(cat "$ROOT/state/current" 2>/dev/null || echo none)}" \
    docker compose --project-directory "$dir" -f "$dir/compose.yml" "${extra[@]}" --env-file "$ENV_FILE" "$@"
}

passphrase() {
  local pass
  pass="$(env_get BACKUP_PASSPHRASE)"
  [ "${#pass}" -ge 32 ] || die 'BACKUP_PASSPHRASE fehlt oder ist zu kurz – ohne Verschlüsselung wird nichts gesichert.'
  printf '%s' "$pass"
}

encrypt_to() { gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file <(passphrase) --symmetric --cipher-algo AES256 -o "$1"; }
decrypt() { gpg --batch --quiet --pinentry-mode loopback --passphrase-file <(passphrase) --decrypt "$1"; }

backup() {
  local kind="$1" stamp db file size
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$DIR"; chmod 700 "$DIR"
  umask 077
  for db in "${DATABASES[@]}"; do
    file="$DIR/$db-$stamp-$kind.dump.gpg"
    compose exec -T db pg_dump -U marktat -d "$db" -Fc --no-owner --no-privileges | encrypt_to "$file" \
      || { rm -f "$file"; die "pg_dump von $db fehlgeschlagen"; }
    size="$(stat -c %s "$file")"
    [ "$size" -gt 500 ] || { rm -f "$file"; die "Sicherung von $db ist unvollständig ($size Bytes)"; }
    log "$db gesichert: $(basename "$file") ($((size / 1024)) KB)"
    upload "$file"
  done
}

upload() {
  [ -n "$(env_get BACKUP_R2_BUCKET)" ] || return 0
  compose run --rm --no-deps -T -v "$DIR:/backups:ro" tools pnpm --silent backup:upload "/backups/$(basename "$1")" \
    || log "WARNUNG: Upload nach R2 fehlgeschlagen – lokale Sicherung ist vorhanden"
}

prune() {
  local days
  days="$(env_get BACKUP_RETENTION_DAYS)"; days="${days:-14}"
  [[ "$days" =~ ^[0-9]+$ ]] && [ "$days" -ge 1 ] || die 'BACKUP_RETENTION_DAYS muss eine Zahl ≥ 1 sein'
  find "$DIR" -maxdepth 1 -name '*.dump.gpg' -type f -mtime +"$days" -print -delete | sed 's/^/gelöscht: /' >&2 || true
}

verify() {
  local file="${1:?Aufruf: backup.sh verify <datei.gpg>}" entries
  [ -f "$file" ] || die "$file gibt es nicht"
  entries="$(decrypt "$file" | compose exec -T db pg_restore --list | grep -c ' TABLE ' || true)"
  [ "$entries" -gt 0 ] || die "$file enthält keine Tabellen (falsches Passwort oder beschädigt?)"
  log "$(basename "$file"): entschlüsselt, $entries Tabellen – in Ordnung"
}

restore() {
  local file="${1:?Aufruf: backup.sh restore <datei.gpg>}" db answer
  [ -f "$file" ] || die "$file gibt es nicht"
  db="$(basename "$file")"; db="${db%%-[0-9]*}"
  [[ " ${DATABASES[*]} " == *" $db "* ]] || die "Datenbank aus dem Dateinamen nicht erkennbar: $db"
  verify "$file"
  echo "ACHTUNG: Datenbank $db wird mit dem Stand aus $(basename "$file") überschrieben. Neuere Daten gehen verloren."
  echo "Vorher wird automatisch eine Sicherung des jetzigen Stands angelegt. Zum Fortfahren WIEDERHERSTELLEN eingeben:"
  read -r answer
  [ "$answer" = "WIEDERHERSTELLEN" ] || die 'abgebrochen'
  backup pre-restore
  compose stop api web auth
  decrypt "$file" | compose exec -T db pg_restore -U marktat -d "$db" --clean --if-exists --no-owner --no-privileges --single-transaction \
    || { compose start auth api web; die "Wiederherstellung von $db fehlgeschlagen (Transaktion zurückgerollt, alter Stand bleibt)"; }
  compose start auth api web
  log "$db aus $(basename "$file") wiederhergestellt. Suchindex neu aufbauen: docker compose … exec api pnpm search:reindex (docs/deployment.md)"
}

case "${1:-daily}" in
  daily) backup daily; prune ;;
  pre-deploy) backup pre-deploy ;;
  verify) verify "${2:-}" ;;
  restore) restore "${2:-}" ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
