#!/usr/bin/env bash
#
# One-command deploy onto a fresh Oracle Cloud (or any Ubuntu) VM.
#
# Run it on the server, from the repository root:
#
#   bash deploy/oracle-setup.sh
#
# It is safe to re-run. Every step checks whether it has already been done, so
# a failure halfway through can be corrected and the script started again.
#
set -euo pipefail

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '%s!! %s %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '%sxx %s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
COMPOSE="docker compose -f deploy/docker-compose.yml"

# Runs a command inside the running app container.
in_app() { $COMPOSE exec -T app "$@"; }

# --------------------------------------------------------------------------
# 1. Prerequisites
# --------------------------------------------------------------------------
say "Checking prerequisites"

if ! command -v docker >/dev/null 2>&1; then
  die "Docker is not installed. Run:
  sudo apt update && sudo apt install -y docker.io docker-compose-v2
  sudo usermod -aG docker \$USER && newgrp docker"
fi

if ! docker compose version >/dev/null 2>&1; then
  die "The docker compose plugin is missing. Install docker-compose-v2."
fi

if ! docker info >/dev/null 2>&1; then
  die "Cannot talk to the Docker daemon. If you just added yourself to the
docker group, run 'newgrp docker' or log out and back in."
fi

ARCH="$(uname -m)"
say "Architecture is ${ARCH}"
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  # better-sqlite3 compiles from source. The first build on a shared ARM core
  # takes several minutes and looks stalled while it does.
  warn "ARM detected. The first build compiles better-sqlite3 and takes a while."
fi

# --------------------------------------------------------------------------
# 2. Configuration
# --------------------------------------------------------------------------
ENV_FILE="$ROOT/deploy/.env"

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/deploy/.env.deploy.example" "$ENV_FILE"
  die "Created deploy/.env from the example. Fill it in, then run this again.

Required:
  SITE_ADDRESS                   hostname, not a bare IP (see below)
  XERO_TOKEN_ENCRYPTION_KEY_V1   generate a NEW one:
                                   node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"
  XERO_RAMWALL_READ_CORE_DEV_CLIENT_ID
  XERO_RAMWALL_READ_CORE_DEV_CLIENT_SECRET

Let's Encrypt will not issue for an IP address. With no domain, sslip.io gives
you a hostname free: <your-ip>.sslip.io"
fi

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

[ -n "${SITE_ADDRESS:-}" ] || die "SITE_ADDRESS is empty in deploy/.env"
[ -n "${XERO_TOKEN_ENCRYPTION_KEY_V1:-}" ] || die "XERO_TOKEN_ENCRYPTION_KEY_V1 is empty in deploy/.env"

case "$SITE_ADDRESS" in
  *.sslip.io|*.nip.io) : ;;
  *[0-9].[0-9]*.[0-9]*.[0-9]*)
    die "SITE_ADDRESS looks like a bare IP address.

Let's Encrypt will not issue a certificate for one, and without a certificate
there is no HTTPS. Session cookies are secure-only in production, so nobody
could sign in. Use ${SITE_ADDRESS}.sslip.io instead."
  ;;
esac

say "Site address is ${SITE_ADDRESS}"

# --------------------------------------------------------------------------
# 3. Firewall
#
# The trap that costs an afternoon: adding the ingress rule to the OCI security
# list is only half of it. Oracle's Ubuntu images also ship iptables rules that
# drop everything except SSH, and they survive reboots.
# --------------------------------------------------------------------------
if command -v iptables >/dev/null 2>&1; then
  for PORT in 80 443; do
    if sudo iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
      say "Port ${PORT} already open in iptables"
    else
      say "Opening port ${PORT} in iptables"
      sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$PORT" -j ACCEPT
      sudo netfilter-persistent save >/dev/null 2>&1 \
        || warn "Could not persist iptables rules. Install iptables-persistent, or the rule is lost on reboot."
    fi
  done
  warn "Also add ingress rules for TCP 80 and 443 to the OCI security list in
     the console. The instance firewall alone is not enough."
fi

# --------------------------------------------------------------------------
# 4. Build and start
# --------------------------------------------------------------------------
say "Building and starting (first run takes several minutes)"
$COMPOSE up -d --build

say "Waiting for the app to answer"
DEADLINE=$(( SECONDS + 300 ))
until in_app node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
  if [ "$SECONDS" -ge "$DEADLINE" ]; then
    $COMPOSE logs --tail 40 app
    die "The app did not start within five minutes. Logs above."
  fi
  sleep 5
done
say "App is serving"

# --------------------------------------------------------------------------
# 5. First-run setup
# --------------------------------------------------------------------------

# The seed leaves an existing administrator's password alone, so this is safe
# to re-run: it prints a password only the first time.
say "Seeding (prints the admin password once, on first run only)"
in_app npx tsx db/seed.ts || warn "Seed reported a problem. Check the output above."

# The redirect URI lives in the xero_apps table, copied from the environment
# when the row was first seeded. The seed uses onConflictDoNothing, so setting
# the variable alone never updates an existing row, and Xero then refuses the
# consent request naming a URL nobody configured here.
say "Pointing the Xero apps at https://${SITE_ADDRESS}"
in_app npx tsx scripts/set-redirect-uri.ts "https://${SITE_ADDRESS}"

# --------------------------------------------------------------------------
# 6. What is left for a person
# --------------------------------------------------------------------------
cat <<EOF

${GREEN}Deployed.${OFF}  https://${SITE_ADDRESS}

${DIM}Caddy obtains its certificate on the first request, so the very first load
may take a few seconds and the one after that will be instant.${OFF}

Still to do by hand:

  1. Register this redirect URI on every Xero app at
     https://developer.xero.com/app/manage

         https://${SITE_ADDRESS}/api/xero/oauth/callback

     Xero compares it character for character.

  2. Sign in with the password printed above, then change it.

  3. Clear the demo data before connecting a real organisation, or invented
     figures sit beside real ones in the same tables:

         ${COMPOSE} exec app npx tsx scripts/demo-data.ts --clear

  4. Back up the database. One file holds every entity, encrypted token and
     audit record, and nothing backs it up automatically.

${YELLOW}Do not run a second instance.${OFF} Two processes writing one SQLite file will
corrupt it. This deployment is single-instance until it moves to D1 or Postgres.
EOF
