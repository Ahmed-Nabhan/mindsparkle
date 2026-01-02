FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application code
COPY . .

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "index.js"]
