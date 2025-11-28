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
# --- Stage 2: Runner ---
FROM n8nio/n8n:latest

USER root

# 1. No need for python/make/g++ anymore (since we don't install deps)
# 2. No need for /home/node/deps or NODE_PATH

ENV N8N_CUSTOM_EXTENSIONS="/home/node/n8n-custom-nodes"
RUN mkdir -p $N8N_CUSTOM_EXTENSIONS/n8n-nodes-zyndai

# 3. Copy ONLY the compiled code and package.json
WORKDIR $N8N_CUSTOM_EXTENSIONS/n8n-nodes-zyndai
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package.json .

# 4. Set Permissions
RUN chown -R node:node /home/node

USER node