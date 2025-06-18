FROM node:18-alpine
LABEL authors="rid"

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

CMD ["npm", "start"]

ENTRYPOINT ["top", "-b"]