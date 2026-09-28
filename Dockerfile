FROM node:22-alpine
LABEL authors="rid"

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

ENV CONNECTIONS_CONFIG=config/connections.json

CMD ["npm", "start"]