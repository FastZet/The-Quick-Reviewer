# Use a lightweight official Node.js runtime as a base image
FROM node:18-slim

# Set the working directory in the container
WORKDIR /app

# Install Git (already in your Dockerfile)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Clone Tube Search add-on repository into the current directory
RUN git clone https://github.com/FastZet/The-Quick-Reviewer.git .

# Install application dependencies for the cloned project
RUN npm install --omit=dev

# Set the port environment variable. Hugging Face Spaces typically use 7860.
ENV PORT=7860

# Expose the port on which your application will listen
EXPOSE 7860

# Define the command to run your app
CMD ["npm", "start"]
