#!/usr/bin/env bash
# MarktAT – Ersteinrichtung eines frischen Servers (Ubuntu 24.04 LTS). Einmalig als root ausführen:
#
#   curl -fsSLO https://raw.githubusercontent.com/n1kob1ko/marktat/main/infra/production/setup-server.sh
#   less setup-server.sh          # vorher lesen
#   bash setup-server.sh "ssh-ed25519 AAAA… github-deploy"
#
# Das Argument ist der ÖFFENTLICHE Schlüssel, mit dem sich GitHub Actions als Benutzer „deploy“ anmeldet
# (docs/deployment.md, Abschnitt Ersteinrichtung). Das Skript:
#   - installiert Updates, Docker (offizielles Paket), Firewall, fail2ban, automatische Sicherheitsupdates, gpg
#   - legt den Benutzer deploy an (nur Schlüssel-Anmeldung) und /opt/marktat
#   - sperrt Passwort-Anmeldungen per SSH (root nur noch mit Schlüssel)
#   - öffnet nur SSH (22), HTTP (80) und HTTPS (443)
#   - richtet die tägliche Datenbanksicherung ein (03:30 Uhr)
# Es installiert MarktAT selbst noch nicht und kann gefahrlos erneut ausgeführt werden.
set -Eeuo pipefail

DEPLOY_KEY="${1:?Aufruf: setup-server.sh \"<öffentlicher SSH-Schlüssel für GitHub Actions>\"}"
[[ "$DEPLOY_KEY" =~ ^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa)\  ]] || { echo 'Das sieht nicht nach einem öffentlichen SSH-Schlüssel aus.'; exit 1; }
[ "$(id -u)" = 0 ] || { echo 'Bitte als root ausführen.'; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] || echo "Hinweis: getestet für Ubuntu 24.04, gefunden: $PRETTY_NAME"

ROOT=/opt/marktat
export DEBIAN_FRONTEND=noninteractive

echo '== Systempakete'
apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q ca-certificates curl gnupg ufw fail2ban unattended-upgrades util-linux

echo '== Docker (offizielles Repository)'
if ! command -v docker > /dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo '== Automatische Sicherheitsupdates'
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

echo '== Zeitzone und Auslagerungsspeicher'
timedatectl set-timezone Europe/Vienna || true
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo '== Benutzer deploy'
id deploy > /dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
# Mitglied der Gruppe docker = darf Container steuern (entspricht root-Rechten auf diesem Server)
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
grep -qxF "$DEPLOY_KEY" /home/deploy/.ssh/authorized_keys || echo "$DEPLOY_KEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys

echo '== SSH: keine Passwort-Anmeldung'
# Vorher sicherstellen, dass root einen Schlüssel hat – sonst sperrt man sich aus
if [ -s /root/.ssh/authorized_keys ]; then
  cat > /etc/ssh/sshd_config.d/10-marktat.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  systemctl reload ssh || systemctl reload sshd
else
  echo 'WARNUNG: root hat keinen SSH-Schlüssel – Passwort-Anmeldung bleibt vorerst erlaubt (docs/deployment.md).'
fi

echo '== Firewall'
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
systemctl enable --now fail2ban

echo "== $ROOT"
install -d -m 750 -o deploy -g deploy "$ROOT" "$ROOT/releases" "$ROOT/state" "$ROOT/access"
install -d -m 700 -o deploy -g deploy "$ROOT/backups"
# Umgebung aus der Vorlage anlegen und die Geheimnisse direkt hier erzeugen (verlassen den Server nie).
# Eine vorhandene .env bleibt unverändert; generate-secrets.mjs füllt nur leere Einträge.
RAW="https://raw.githubusercontent.com/n1kob1ko/marktat/${MARKTAT_REF:-main}/infra/production"
if [ ! -s "$ROOT/.env" ]; then
  curl -fsSL "$RAW/env.production.example" -o "$ROOT/.env"
  echo "$ROOT/.env aus der Vorlage angelegt"
fi
chown deploy:deploy "$ROOT/.env" && chmod 600 "$ROOT/.env"
curl -fsSL "$RAW/generate-secrets.mjs" -o "$ROOT/generate-secrets.mjs"
docker run --rm -u "$(id -u deploy):$(id -g deploy)" -v "$ROOT:/w" -w /w node:22-alpine node generate-secrets.mjs .env
rm -f "$ROOT/generate-secrets.mjs"

echo '== Tägliche Sicherung'
cat > /etc/cron.d/marktat-backup <<CRON
# MarktAT: verschlüsselte Datenbanksicherung (backup.sh), Protokoll in $ROOT/deploy.log
30 3 * * * deploy [ -x $ROOT/current/backup.sh ] && $ROOT/current/backup.sh daily > /dev/null 2>&1
CRON
chmod 644 /etc/cron.d/marktat-backup

echo
echo "Fertig. Nächste Schritte: in $ROOT/.env Domains, E-Mail-Versand und R2 eintragen (docs/deployment.md, Ersteinrichtung)."
echo 'Die Geheimnisse sind bereits gesetzt – nicht kopieren oder weitergeben.'
docker --version
docker compose version
