#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."
config_file="examples/external-demo/.env"

if [[ -f "$config_file" ]]; then
  echo "Existing demo configuration preserved: $config_file"
  exit 0
fi

read -r -p "TokenScope URL [https://localhost:8443]: " base_url
base_url="${base_url:-https://localhost:8443}"

read -r -s -p "Gemini API key: " gemini_key
printf '\n'
read -r -s -p "TokenScope Chat project API key: " chat_key
printf '\n'
read -r -s -p "TokenScope Translation project API key: " translation_key
printf '\n'

for key in "$gemini_key" "$chat_key" "$translation_key"; do
  if [[ -z "$key" || "$key" =~ [[:space:]] ||
        "$key" == *"'"* || "$key" == *\"* ||
        "$key" == *'#'* ]]; then
    echo "Invalid key: use a nonempty key without whitespace, quotes or #."
    exit 1
  fi
done

if [[ "$chat_key" == "$translation_key" ]]; then
  echo "Chat and Translation must use different project keys."
  exit 1
fi

if [[ ! "$base_url" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]]; then
  echo "Enter an HTTP(S) origin, without a path."
  exit 1
fi

(
  set -o noclobber
  {
    printf 'PORT=8080\n'
    printf 'GEMINI_API_KEY=%s\n' "$gemini_key"
    printf 'LLM_MODEL=gemini-3.5-flash-lite\n'
    printf 'TOKENSCOPE_BASE_URL=%s\n' "${base_url%/}"
    printf 'TOKENSCOPE_CHAT_API_KEY=%s\n' "$chat_key"
    printf 'TOKENSCOPE_TRANSLATION_API_KEY=%s\n' "$translation_key"
  } > "$config_file"
)

echo "Private demo configuration saved."