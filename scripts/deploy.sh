#!/usr/bin/env bash
#
# Corellia — host-agnostic one-command deploy over SSH.
#
# Ships the published GHCR image to a remote Docker host and (re)creates the
# stack from compose.deploy.yaml. The host needs Docker + a populated .env; it
# needs NO source checkout and never builds an image locally.
#
# The recreate lets the running daemon drain on SIGTERM (ADR-026 preserve-don't-
# await): `docker compose up -d` sends SIGTERM to the old container, which
# preserves in-flight worktrees before exiting, then starts the new image.
#
# Usage:
#   DEPLOY_HOST=user@host scripts/deploy.sh <tag>
#   scripts/deploy.sh --host user@host <tag>
#   scripts/deploy.sh --rollback <previous-tag>      # same flow, prior tag
#
# Environment:
#   DEPLOY_HOST         ssh target (user@host). Required unless --host given.
#   DEPLOY_DIR          remote dir holding compose.deploy.yaml + .env
#                       (default: /opt/corellia)
#   CORELLIA_OWNER      GHCR owner for the image ref (default: parsed from git
#                       origin, else required)
#   DEPLOY_HOST_PORT    host port to probe for /status (default: 8080)
#
# The bearer token used to verify /status is read from the REMOTE .env
# (FRONT_DOOR_TOKEN) — never passed on the command line or printed.

set -euo pipefail

# ── Locate the compose file next to this script's repo root ──────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/compose.deploy.yaml"

DEPLOY_DIR="${DEPLOY_DIR:-/opt/corellia}"
DEPLOY_HOST_PORT="${DEPLOY_HOST_PORT:-8080}"

# ── Parse arguments ──────────────────────────────────────────────────────────
ROLLBACK=0
TAG=""
HOST="${DEPLOY_HOST:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rollback)
      ROLLBACK=1
      shift
      ;;
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    -h|--help)
      grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "deploy: unknown flag '$1'" >&2
      exit 2
      ;;
    *)
      if [[ -n "${TAG}" ]]; then
        echo "deploy: unexpected extra argument '$1'" >&2
        exit 2
      fi
      TAG="$1"
      shift
      ;;
  esac
done

if [[ -z "${HOST}" ]]; then
  echo "deploy: no host — set DEPLOY_HOST or pass --host user@host" >&2
  exit 2
fi

if [[ -z "${TAG}" ]]; then
  echo "deploy: no image tag given (e.g. sha-abc1234 or v1.2.3)" >&2
  exit 2
fi

# ── Resolve the GHCR owner → full image ref ──────────────────────────────────
OWNER="${CORELLIA_OWNER:-}"
if [[ -z "${OWNER}" ]]; then
  # Parse owner from `git remote get-url origin` (github.com[:/]<owner>/<repo>).
  origin_url="$(git -C "${REPO_ROOT}" remote get-url origin 2>/dev/null || true)"
  OWNER="$(printf '%s\n' "${origin_url}" | sed -nE 's#.*github\.com[:/]([^/]+)/.*#\1#p')"
fi
if [[ -z "${OWNER}" ]]; then
  echo "deploy: cannot determine GHCR owner — set CORELLIA_OWNER" >&2
  exit 2
fi

IMAGE_REF="ghcr.io/${OWNER}/corellia:${TAG}"

if [[ "${ROLLBACK}" -eq 1 ]]; then
  echo "deploy: ROLLBACK to ${IMAGE_REF} on ${HOST}"
else
  echo "deploy: ${IMAGE_REF} → ${HOST}:${DEPLOY_DIR}"
fi

# ── Ensure the remote deploy dir exists and holds the compose file ───────────
# shellcheck disable=SC2029  # DEPLOY_DIR is intentionally expanded locally.
ssh "${HOST}" "mkdir -p '${DEPLOY_DIR}'"

# Copy the compose file if it is absent or differs (idempotent; -a preserves).
scp "${COMPOSE_FILE}" "${HOST}:${DEPLOY_DIR}/compose.deploy.yaml"

# ── Verify the host has a populated .env (secrets never travel from here) ─────
# shellcheck disable=SC2029  # DEPLOY_DIR is intentionally expanded locally.
if ! ssh "${HOST}" "test -f '${DEPLOY_DIR}/.env'"; then
  echo "deploy: ${DEPLOY_DIR}/.env missing on ${HOST}" >&2
  echo "        provision it first (see docs/deploy.md — secrets provisioning)." >&2
  exit 1
fi

# ── Pull the pinned tag, then recreate (draining the old container's SIGTERM) ─
# CORELLIA_IMAGE pins the exact tag for this recreate; it is exported inline so
# it never has to live in the host .env for a one-off deploy.
remote_compose="cd '${DEPLOY_DIR}' && CORELLIA_IMAGE='${IMAGE_REF}' docker compose -f compose.deploy.yaml"

echo "deploy: pulling ${IMAGE_REF} …"
# shellcheck disable=SC2029  # remote_compose is intentionally built and expanded locally.
ssh "${HOST}" "${remote_compose} pull daemon"

echo "deploy: recreating stack (old daemon drains on SIGTERM) …"
# shellcheck disable=SC2029  # remote_compose is intentionally built and expanded locally.
ssh "${HOST}" "${remote_compose} up -d"

# ── Verify GET /status returns 200 using the host-side bearer token ──────────
# The token is read from the remote .env inside the SSH session; it is never
# printed or transmitted from this machine.
echo "deploy: verifying GET /status on ${HOST}:${DEPLOY_HOST_PORT} …"
verify_cmd=$(cat <<REMOTE
set -euo pipefail
cd '${DEPLOY_DIR}'
# shellcheck disable=SC1091
set -a; . ./.env; set +a
port="\${HOST_PORT:-${DEPLOY_HOST_PORT}}"
for attempt in \$(seq 1 30); do
  code=\$(curl -s -o /dev/null -w '%{http_code}' \
    -H "authorization: Bearer \${FRONT_DOOR_TOKEN}" \
    "http://127.0.0.1:\${port}/status" || true)
  if [[ "\${code}" == "200" ]]; then
    echo "deploy: /status OK (200) after \${attempt} attempt(s)"
    exit 0
  fi
  sleep 2
done
echo "deploy: /status did not return 200 (last: \${code:-none})" >&2
exit 1
REMOTE
)
ssh "${HOST}" "bash -s" <<<"${verify_cmd}"

echo "deploy: done — ${IMAGE_REF} live on ${HOST}"
