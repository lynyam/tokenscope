# syntax=docker/dockerfile:1

# ---- dev : serveur Vite, comme avant
FROM node:24-alpine AS dev
WORKDIR /app
CMD ["sh", "-c", "npm ci && npm run dev"]

# ---- build : npm ci + npm run build
FROM node:24-alpine AS build
WORKDIR /app
ARG VITE_API_BASE=/api/v1
ENV VITE_API_BASE=${VITE_API_BASE}
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- eval : Caddy sert le build sur /srv (le bind mount /app ne le cache pas)
FROM caddy:2-alpine AS eval
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 443