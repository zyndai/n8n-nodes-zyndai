#!/bin/bash

set -e

echo "Starting ngrok on port 5678 in background..."
nohup ngrok http 5678 > ngrok.log 2>&1 &

echo "Waiting for ngrok to initialize..."
sleep 3

# ---- Get ngrok public URL ----
NGROK_URL=""

for i in {1..10}; do
    NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels \
        | jq -r '.tunnels[0].public_url')

    if [[ -n "$NGROK_URL" && "$NGROK_URL" != "null" ]]; then
        break
    fi

    echo "Waiting for ngrok URL..."
    sleep 2
done

if [[ -z "$NGROK_URL" || "$NGROK_URL" == "null" ]]; then
    echo "❌ Failed to get ngrok URL"
    exit 1
fi

echo "✅ Ngrok URL found: $NGROK_URL"
echo "👉 Access n8n Editor at: http://localhost:5678 (Use this to avoid ngrok rate limits)"
echo "👉 Use Ngrok URL for Webhooks: $NGROK_URL"

# ---- Strip protocol (https://example.ngrok-free.app → example.ngrok-free.app) ----
HOST="${NGROK_URL#*://}"

echo "Stripped host: $HOST"

# ---- Determine OS sed style ----
if [[ "$OSTYPE" == "darwin"* ]]; then
    SED_CMD="sed -i ''"
else
    SED_CMD="sed -i"
fi

update_env() {
    KEY="$1"
    VALUE="$2"

    if grep -q "^$KEY=" .env; then
        eval $SED_CMD" \"s|^$KEY=.*|$KEY=$VALUE|\" .env"
    else
        echo "$KEY=$VALUE" >> .env
    fi
}

echo "Updating environment variables in .env..."

# ---- Update .env values ----
update_env "N8N_HOST" "$HOST"
update_env "N8N_PROTOCOL" "https"
update_env "N8N_PORT" "5678"

update_env "N8N_EDITOR_BASE_URL" "https://$HOST"
update_env "N8N_PUBLIC_API_BASE_URL" "https://$HOST"
update_env "WEBHOOK_URL" "https://$HOST"
update_env "N8N_PROXY_HOPS" "1"


echo "Updated values:"
grep -E "N8N_HOST|N8N_EDITOR_BASE_URL|N8N_PUBLIC_API_BASE_URL|N8N_PORT|N8N_PROTOCOL" .env

rm ngrok.log

# ---- Docker cross-platform run ----
echo "Starting Docker Compose..."

if command -v docker compose &>/dev/null; then
    docker compose build --no-cache
    docker compose up
else
    docker-compose build --no-cache
    docker-compose up
fi
