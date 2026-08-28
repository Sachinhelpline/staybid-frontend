# ─────────────────────────────────────────────────────────────────────────
# StayBid Voice AI — VOICE-AI-SB-04 — dedicated Voice gateway image.
#
# Builds ONLY the gateway (server/voice-gateway) into dist/ and runs it. The
# gateway is FAIL-CLOSED: with no VOICE_AI_RUNTIME_ENABLED=1 and no security /
# provider env, it accepts /healthz but refuses every session (503). No secret is
# baked into the image — all config is injected at runtime (Railway env).
#
# Build context = the repository root:
#   docker build -f server/voice-gateway/Dockerfile -t staybid-voice-gateway .
# ─────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies incl. devDeps (typescript is needed to compile the gateway).
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund

# Compile the gateway TypeScript to dist/ using the LOCKFILE-INSTALLED compiler
# (the local node_modules/.bin/tsc — never a network `npx` fetch).
COPY server/voice-gateway ./server/voice-gateway
RUN node_modules/.bin/tsc -p server/voice-gateway/tsconfig.json

# ---- runtime image ----------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Fail-closed defaults — the owner supplies the real values at deploy time.
ENV VOICE_AI_RUNTIME_ENABLED=0

# Production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Compiled gateway.
COPY --from=build /app/server/voice-gateway/dist ./server/voice-gateway/dist

EXPOSE 8080
USER node
CMD ["node", "server/voice-gateway/dist/index.js"]
