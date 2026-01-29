# Use Node.js 18 Alpine
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Copy TypeScript files and compile
COPY tsconfig.json ./
RUN npm run build

# Expose port
EXPOSE 3000

# Start the bot
CMD ["npm", "start"]
