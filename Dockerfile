# Build stage
FROM node:22-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-slim AS dev

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

CMD ["npm", "run", "dev"]

# Production stage
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build --chown=node:node /app/dist ./dist

# Standard k8s environment variables with defaults
ENV ACORNOPS_AGENT_LOG_LEVEL=info
ENV ACORNOPS_AGENT_WRITE_ENABLED=false

USER node

CMD ["node", "dist/index.js"]
