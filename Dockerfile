# syntax=docker/dockerfile:1
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Install only production deps using layer caching
COPY package*.json ./
RUN npm config set fund false && npm config set audit false \
 && if [ -f package-lock.json ] ; then npm ci --omit=dev ; else npm install --omit=dev ; fi

# Copy the rest of the source and drop privileges
COPY --chown=node:node . .
USER node

# Ensure the SQLite directory exists and is writable
RUN mkdir -p /app/addon/data

ARG EXPOSE_PORT=7860
ENV PORT=${EXPOSE_PORT}

# Expose the chosen port (metadata only)
EXPOSE ${EXPOSE_PORT}

# Healthcheck hits your existing /health route on the configured port
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

# Start the server (server.js via "npm start")
CMD ["npm", "start"]
