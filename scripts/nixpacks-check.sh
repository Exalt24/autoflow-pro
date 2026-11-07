#!/usr/bin/env bash
# LIFESPAN: permanent (kept as the repo's real Nixpacks build and check script, referenced from docs and CI)
# Starts the Nixpacks-built backend image next to a Redis container and checks that /health answers 200.
# Usage: bash scripts/nixpacks-check.sh [image name, default autoflow-backend-nixpacks]
# The Supabase settings are placeholders (the same ones the Cloud Run container run used): /health does not call Supabase.
set -uo pipefail

IMAGE="${1:-autoflow-backend-nixpacks}"
NET="nixcheck-net-$$"
REDIS="nixcheck-redis-$$"
APP="nixcheck-app-$$"
HOST_PORT="${HOST_PORT:-18080}"
status=1
health="$(mktemp)"

cleanup() {
  rm -f "$health"
  docker rm -f "$APP" "$REDIS" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
}
trap cleanup EXIT

echo "## image"
docker image inspect "$IMAGE" --format 'size {{.Size}} bytes, user "{{.Config.User}}", cmd {{.Config.Cmd}}, entrypoint {{.Config.Entrypoint}}'

docker network create "$NET" >/dev/null
docker run -d --name "$REDIS" --network "$NET" redis:7-alpine >/dev/null
docker run -d --name "$APP" --network "$NET" -p "$HOST_PORT":8080 \
  -e PORT=8080 -e NODE_ENV=production -e CORS_ORIGIN=http://localhost:3000 \
  -e REDIS_URL="redis://$REDIS:6379" \
  -e SUPABASE_URL=http://supabase.invalid -e SUPABASE_ANON_KEY=placeholder -e SUPABASE_SERVICE_KEY=placeholder \
  "$IMAGE" >/dev/null

echo "## GET /health"
for i in $(seq 1 60); do
  code="$(curl -s -o "$health" -w '%{http_code}' "http://127.0.0.1:$HOST_PORT/health" || true)"
  if [ "$code" = "200" ]; then
    cat "$health"; echo; echo "HTTP $code (after $i tries)"
    status=0
    break
  fi
  sleep 1
done

if [ "$status" -ne 0 ]; then echo "HTTP ${code:-none}: /health did not answer 200"; fi
echo "## GET /"
curl -s -w '\nHTTP %{http_code}\n' "http://127.0.0.1:$HOST_PORT/" || true
echo "## container user and process"
docker exec "$APP" sh -c 'id; ps -o pid,args -p 1' 2>&1 | head -5
echo "## container log (tail)"
docker logs --tail 12 "$APP" 2>&1
exit "$status"
