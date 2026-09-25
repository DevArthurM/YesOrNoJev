# ---- build: install workspaces, build the web app and bundle the server ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @yesornojev/shared --workspace @yesornojev/server --workspace @yesornojev/web --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build -w @yesornojev/web && npm run build -w @yesornojev/server

# ---- runtime: one small Node process serving the API and the static web app ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/web DATABASE_PATH=/app/data/yesornojev.sqlite
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist ./web
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "dist/index.js"]
