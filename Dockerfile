FROM ghcr.io/puppeteer/puppeteer:latest

     ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

     WORKDIR /app

     COPY package*.json ./
     RUN npm install

     COPY . .

     EXPOSE 3000

     CMD ["node", "proxy.js"]