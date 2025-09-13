# Debian-based image to avoid musl build issues for better-sqlite3
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Base packages
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first for better caching
COPY package*.json ./
RUN npm config set fund false && npm config set audit false \
 && if [ -f package-lock.json ] ; then npm ci --omit=dev ; else npm install --omit=dev ; fi

# Copy source
COPY --chown=node:node . .

# Ensure SQLite directory exists and is owned by node BEFORE switching user
RUN install -d -o node -g node /app/addon/data

# Drop privileges
USER node

ARG EXPOSE_PORT=7860
ENV PORT=${EXPOSE_PORT}
EXPOSE ${EXPOSE_PORT}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

CMD ["npm", "start"]
