FROM node:22.22.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY backend backend
RUN pnpm --filter backend build

FROM dependencies AS test
COPY backend backend
COPY fixtures fixtures
WORKDIR /app/backend
CMD ["pnpm", "test:integration"]

FROM base AS runtime
ENV NODE_ENV=production
ENV DOCUMENTS_DIR=/app/fixtures/documents
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --prod --frozen-lockfile --filter backend
COPY --from=build /app/backend/dist backend/dist
COPY backend/supabase backend/supabase
COPY fixtures fixtures
USER node
WORKDIR /app/backend
EXPOSE 3001
CMD ["node", "dist/main.js"]
