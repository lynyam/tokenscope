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

get_env() {
  grep -E "^[[:space:]]*$1[[:space:]]*=" .env | tail -n 1 | cut -d= -f2- \
    | tr -d '\r' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"//' -e 's/"$//' \
          -e "s/^'//" -e "s/'\$//"
}

for key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DATABASE_URL JWT_ISSUER JWT_AUDIENCE; do
  [ -n "$(get_env "$key")" ] || {
    echo "Erreur : $key est absent ou vide dans .env" >&2
    exit 1
  }
done

for key in BACKEND_PORT FRONTEND_PORT JWT_ACCESS_TTL_SECONDS; do
  case "$(get_env "$key")" in
    ''|*[!0-9]*)
      echo "Erreur : $key doit être un entier positif dans .env" >&2
      exit 1
      ;;
  esac
done

if grep -qE '^[[:space:]]*JWT_SECRET[[:space:]]*=' .env; then
  : # la clé existe déjà, rien à ajouter
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

command -v docker >/dev/null 2>&1 || {
  echo "Erreur : docker introuvable" >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "Erreur : Docker n'est pas démarré" >&2
  exit 1
}

secret="$(docker run --rm node:24-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

[ "${#secret}" -eq 64 ] || {
  echo "Erreur : génération du JWT_SECRET impossible" >&2
  exit 1
}

sed "s|^[[:space:]]*JWT_SECRET[[:space:]]*=.*|JWT_SECRET=$secret|" .env > .env.tmp
mv .env.tmp .env
chmod 600 .env

echo "JWT_SECRET généré"
