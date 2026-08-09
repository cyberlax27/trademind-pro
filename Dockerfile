FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js app.js index.html ./
COPY public ./public
COPY logo-clean.png logo-community.png ./

EXPOSE 5000

CMD ["node", "server.js"]
