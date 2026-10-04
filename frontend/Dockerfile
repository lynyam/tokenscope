# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
ARG VITE_API_BASE=/api/v1
ENV VITE_API_BASE=${VITE_API_BASE}
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build