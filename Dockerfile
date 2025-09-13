# syntax=docker/dockerfile:1
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Optional: install curl for healthcheck + build tools for native modules (SQLite)
RUN apk add --no-cache curl python3 make g++

# Install only production deps using layer caching
COPY package*.json ./
RUN npm config set fund false && npm config set audit false \
 && if [ -f package-lock.json ] ; then npm ci --omit=dev ; else npm install --omit=dev ; fi

# Copy the rest of the source and drop privileges
COPY --chown=node:node . .
USER node

# Match your server defaults
ENV PORT=7860
EXPOSE 7860

# Healthcheck hits your existing /health route
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:7860/health || exit 1

# Start the server (server.js via "npm start")
CMD ["npm", "start"]
