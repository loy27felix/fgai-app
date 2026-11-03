FROM node:22-alpine AS build
WORKDIR /app
COPY upstream/package.json upstream/package-lock.json ./
RUN npm ci --ignore-scripts
COPY upstream/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ARG BUILD_COMMIT=unknown
ARG BUILD_VERSION=unknown
ARG BUILD_TIME=unknown
ARG BUILD_ENVIRONMENT=unknown
ARG BUILD_DIRTY=unknown
ENV BUILD_COMMIT=$BUILD_COMMIT BUILD_VERSION=$BUILD_VERSION BUILD_TIME=$BUILD_TIME BUILD_ENVIRONMENT=$BUILD_ENVIRONMENT BUILD_DIRTY=$BUILD_DIRTY
ENV NODE_ENV=production MEILIN_MODE=fg MEILIN_BIND=0.0.0.0 FG_DIRECTOR_PORT=5310
COPY upstream/package.json upstream/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY upstream/server ./server
COPY upstream/skills ./skills
COPY upstream/schema.sql ./schema.sql
COPY --from=build /app/web/dist ./web/dist
EXPOSE 5310
HEALTHCHECK --interval=10s --timeout=5s --retries=10 CMD node -e "fetch('http://127.0.0.1:5310/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/fg-server.mjs"]
