# Fewer on Fly.io: ONE image, TWO process groups (see fly.toml).
#   web    -> `next start`            (the Desk + API routes)
#   worker -> `tsx scripts/worker.ts` (the long-running AgentMail inbox listener)
#
# No env or secret is baked in: every value arrives at runtime via `fly secrets`.
#
# Tradeoff (hackathon): devDependencies stay in the runtime image because the worker is TypeScript
# run by `tsx` (a devDependency). That costs a few hundred MB and a slightly larger attack surface;
# the cleaner follow-up is to move `tsx` to dependencies and `npm prune --omit=dev` after the build.

FROM node:24-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1

# Non-root from here on. The official image's `node` user (uid 1000) has a real home for npm's cache/logs.
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

# Install first so this layer is cached until the lockfile changes.
# (NODE_ENV is deliberately NOT set yet: `npm ci` would then skip the devDependencies we need.)
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY --chown=node:node . .
RUN npm run build

# Runtime. Both process groups start from this same image; fly.toml supplies each command.
# (No ENTRYPOINT on purpose: Fly's [processes] commands replace CMD, they do not wrap an ENTRYPOINT.)
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start", "--", "-p", "3000", "-H", "0.0.0.0"]
