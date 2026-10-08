# syntax=docker/dockerfile:1

# ---- dev : même comportement qu'avant (bind mount sur /app, démarrage par npm run dev)
FROM node:24-alpine AS dev
WORKDIR /app
CMD ["sh", "-c", "npm ci && npm run dev"]

# ---- build : compile NestJS et génère Prisma Client (via le script prebuild)
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build && cp -r src/generated dist/generated

# ---- eval : le code compilé vit dans /opt/tokenscope/backend, pas dans /app,
#      donc le bind mount de développement ne le masque pas
FROM node:24-alpine AS eval
ENV NODE_ENV=production
WORKDIR /opt/tokenscope/backend
# node_modules complet : la CLI Prisma (devDependency) est nécessaire au démarrage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY docker/eval-start.sh ./eval-start.sh
RUN sed -i 's/\r$//' eval-start.sh && chmod +x eval-start.sh
EXPOSE 3000
CMD ["./eval-start.sh"]