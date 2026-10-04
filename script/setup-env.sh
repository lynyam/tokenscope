#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  echo ".env déjà présent"
else
  if [ ! -f .env.example ]; then
    echo "Erreur : .env.example introuvable" >&2
    exit 1
  fi
  cp .env.example .env
  echo ".env créé depuis .env.example"
fi

if grep -qE '^[[:space:]]*JWT_SECRET[[:space:]]*=' .env; then
    continue
else
    echo "JWT_SECRET=" >> .env
fi

value="$(grep -E '^[[:space:]]*JWT_SECRET[[:space:]]*=' .env \
  | tail -n 1 \
  | cut -d= -f2- \
  | tr -d '\r' \
  | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
        -e 's/^"//' -e 's/"$//' \
        -e "s/^'//" -e "s/'\$//")"

if [ -n "$value" ]; then
  echo ".env opérationnel"
  exit 0
fi

# Prérequis Docker
command -v docker >/dev/null 2>&1 || {
  echo "Erreur : docker introuvable" >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "Erreur : Docker n'est pas démarré" >&2
  exit 1
}

# Génération du secret (32 octets aléatoires, en hexadécimal)
secret="$(docker run --rm node:24-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

[ "${#secret}" -eq 64 ] || {
  echo "Erreur : génération du JWT_SECRET impossible" >&2
  exit 1
}

# Écriture dans .env
sed "s|^[[:space:]]*JWT_SECRET[[:space:]]*=.*|JWT_SECRET=$secret|" .env > .env.tmp
mv .env.tmp .env
chmod 600 .env

echo "JWT_SECRET généré"