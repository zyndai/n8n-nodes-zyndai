# --- Stage 1: Builder ---
FROM node:20-alpine AS builder

# Install build tools
RUN apk add --no-cache python3 make g++ jq

WORKDIR /build

# Copy dependency files first
COPY package.json .
COPY tsconfig.json .
COPY gulpfile.js .
COPY build/build.js ./build/

# Move n8n-workflow from peerDependencies → dependencies
RUN jq 'del(.peerDependencies["n8n-workflow"]) | .dependencies["n8n-workflow"] = "*"' package.json > package.json.tmp \
    && mv package.json.tmp package.json

# Install dependencies
RUN npm install --legacy-peer-deps --include=dev

# Copy remaining source
COPY . .

# Build project
RUN npm run build


# --- Stage 2: Runner ---
FROM n8nio/n8n:latest

USER root

ENV N8N_CUSTOM_EXTENSIONS="/home/node/n8n-custom-nodes"

RUN mkdir -p $N8N_CUSTOM_EXTENSIONS/n8n-nodes-zyndai

WORKDIR $N8N_CUSTOM_EXTENSIONS/n8n-nodes-zyndai

# Copy compiled output only
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package.json .

RUN chown -R node:node /home/node

USER node