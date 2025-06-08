# Use a base image with Chromium already installed
FROM ghcr.io/puppeteer/puppeteer:latest

# Set the working directory
WORKDIR /app

# Copy all files to the container
COPY . .

# Install dependencies
RUN npm install

# Expose port
EXPOSE 3000

# Run your app
CMD ["npm", "start"]
