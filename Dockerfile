FROM node:22-alpine
LABEL authors="rid"

WORKDIR /app

COPY package*.json tsconfig.json ./
COPY src ./src
COPY examples ./examples

RUN npm ci && npm run build && npm prune --omit=dev

ENV SSE_TO_MQTT_CONFIG=/app/config.json

CMD ["node", "dist/cli.js"]
