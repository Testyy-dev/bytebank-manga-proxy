FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /app

# Copy package files as root, then fix permissions
COPY --chown=puppeteer:puppeteer package*.json ./

# Run npm install as puppeteer user to avoid EACCES
USER puppeteer
RUN npm install --no-audit --no-fund

# Copy remaining files with correct ownership
COPY --chown=puppeteer:puppeteer . .

EXPOSE 3000

CMD ["node", "api/proxy.js"]