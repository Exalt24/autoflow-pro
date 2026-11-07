#!/usr/bin/env bash
# LIFESPAN: permanent (kept as the repo's real Nixpacks build and check script, referenced from docs and CI)
# Builds the backend image with Nixpacks, run from a Linux container so it works on a Windows or Mac Docker Desktop too.
# The container gets the host's Docker socket, so the image lands in the host's Docker as <name>.
# Usage: bash scripts/nixpacks-build.sh [source folder, default backend] [image name, default autoflow-backend-nixpacks]
# The source is copied first without node_modules, dist and .env, so the build sees what a fresh clone would.
set -euo pipefail

NIXPACKS_VERSION="${NIXPACKS_VERSION:-1.41.0}"
SRC="${1:-backend}"
NAME="${2:-autoflow-backend-nixpacks}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tar --exclude=node_modules --exclude=dist --exclude=.env --exclude=run-archive -cf - -C "$SRC" . | tar xf - -C "$work"

mount_path="$work"
if command -v cygpath >/dev/null 2>&1; then mount_path="$(cygpath -m "$work")"; fi

export MSYS_NO_PATHCONV=1
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$mount_path":/app \
  -e NIXPACKS_VERSION="$NIXPACKS_VERSION" -e IMAGE_NAME="$NAME" -e DOCKER_BUILDKIT=1 \
  docker:cli sh -c '
    set -e
    apk add --no-cache curl >/dev/null
    curl -sSfL "https://github.com/railwayapp/nixpacks/releases/download/v${NIXPACKS_VERSION}/nixpacks-v${NIXPACKS_VERSION}-x86_64-unknown-linux-musl.tar.gz" | tar xz -C /usr/local/bin
    chmod +x /usr/local/bin/nixpacks
    echo "## nixpacks version"; nixpacks --version
    echo "## nixpacks plan"; nixpacks plan /app
    echo "## nixpacks build"; nixpacks build /app --name "$IMAGE_NAME"
  '
