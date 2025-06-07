FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /app

COPY package*.json ./

USER root
RUN npm install
USER puppeteer

COPY . .

EXPOSE 3000

CMD ["node", "proxy.js"]