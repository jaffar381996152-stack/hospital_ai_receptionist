# Use Node.js 18 Alpine (LTS) for small image size
FROM node:18-alpine

# Set environment to production
ENV NODE_ENV=production

# Create app directory
WORKDIR /app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy app source code
COPY . .

# Create directory for SQLite db and logs if they don't exist, and set permissions
RUN mkdir -p data logs \
    && chown -R node:node /app

# Switch to non-root user for security
USER node

# Expose port 3000
EXPOSE 3000

# Start the application with PM2 clustering
CMD ["npm", "run", "start:prod"]
