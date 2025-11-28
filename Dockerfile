# --- Stage 1: Builder ---
FROM n8nio/n8n:latest AS builder

USER root

# Install build tools
RUN apk add --update --no-cache python3 make g++ jq
RUN npm install -g typescript gulp

WORKDIR /build

# Copy files
COPY package.json .
COPY tsconfig.json .
COPY gulpfile.js .
COPY build/build.js ./build/

# FORCE n8n-workflow installation (The jq Fix)
# We move n8n-workflow from peerDeps to deps so it installs reliably
RUN jq 'del(.peerDependencies["n8n-workflow"]) | .dependencies["n8n-workflow"] = "*"' package.json > package.json.tmp && mv package.json.tmp package.json

# Install all dependencies
RUN npm install --legacy-peer-deps --include=dev

# Copy source
COPY . .

# Run Build (Uses build.js -> esbuild)
RUN npm run build

# --- Stage 2: Runner ---
FROM n8nio/n8n:latest

USER root

# 1. Install System Dependencies
RUN apk add --update --no-cache python3 make g++

# 2. Setup Directories
ENV N8N_CUSTOM_EXTENSIONS="/home/node/n8n-custom-nodes"
ENV DEPS_DIR="/home/node/deps"
ENV NODE_ENV=production
# Critical: Tell Node.js where to find dependencies
ENV NODE_PATH="$DEPS_DIR/node_modules"

RUN mkdir -p $N8N_CUSTOM_EXTENSIONS/n8n-nodes-zyndai
RUN mkdir -p $DEPS_DIR

# 3. Install Production Dependencies in HIDDEN Directory
WORKDIR $DEPS_DIR
COPY package.json .
RUN npm install --production --legacy-peer-deps

# 4. Copy Compiled Code
WORKDIR $N8N_CUSTOM_EXTENSIONS/n8n-nodes-zyndai
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package.json .

# 5. Set Permissions
RUN chown -R node:node /home/node

USER node