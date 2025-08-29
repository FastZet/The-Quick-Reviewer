# Use a lightweight official Node.js runtime
FROM node:24-slim

ENV NODE_ENV=production

# System dependencies for cloning the repository
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Clone your application's source code from GitHub
ARG REPO_URL=https://github.com/USERNAME/The-Quick-Reviewer.git

# Add an argument for the branch name, defaulting to 'devel' for this testing instance
ARG GIT_BRANCH=devel

# Use the -b flag to specify the branch to clone
RUN git clone --depth 1 -b ${GIT_BRANCH} ${REPO_URL} .

# Remove any old lockfiles to ensure a clean install based on the new package.json
RUN rm -f package-lock.json yarn.lock pnpm-lock.yaml

# Install production dependencies defined in your repository's package.json
RUN npm install --omit=dev && npm cache clean --force

# Set the port environment variable for Hugging Face Spaces
ENV PORT=7860
EXPOSE 7860

# Define the command to run your app using the script from your package.json
CMD ["npm", "start"]
