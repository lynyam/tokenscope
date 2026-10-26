#!/bin/sh
set -eu

npx prisma migrate deploy
exec node dist/main.js