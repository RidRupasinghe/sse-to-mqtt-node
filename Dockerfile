# Build stage: compile TypeScript with dev dependencies
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: compiled output and production dependencies only
FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/RidRupasinghe/sse-to-mqtt-node" \
      org.opencontainers.image.description="Bridge Server-Sent Events (SSE) streams to MQTT topics" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    CONNECTIONS_CONFIG=/config/connections.json
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist

# Mount the connections file at /config/connections.json and pass settings as environment variables
USER node
ENTRYPOINT ["node", "dist/cli.js"]
