# syntax=docker/dockerfile:1
FROM node:24-alpine AS test
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY config ./config
COPY test ./test
CMD ["npm", "test"]

# The application uses only Node built-ins. No Jest/jsdom, credentials, host
# node_modules or source bind mount is needed in the runtime image.
FROM node:24-alpine AS runtime
WORKDIR /app
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node config ./config
USER node
HEALTHCHECK --interval=2s --timeout=4s --start-period=2s --retries=15 \
  CMD ["node", "--env-file=/run/demo.env", "src/evaluation-runtime.js", "health"]
CMD ["node", "--env-file=/run/demo.env", "src/server.js"]
