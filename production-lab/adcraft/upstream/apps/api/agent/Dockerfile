FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY agent/package.json agent/package-lock.json ./
COPY agent/patches ./patches
RUN npm ci --ignore-scripts
RUN ./node_modules/.bin/patch-package
COPY agent/src ./src
COPY agent/skills ./skills
COPY agent/scripts ./scripts
COPY agent/tsconfig.json ./
COPY agent/tsconfig.build.json ./
RUN npm run verify:skills
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/skills ./skills
COPY --from=build /app/src/generated/*.json ./dist/src/generated/
COPY --from=build /app/skills ./dist/skills
ENV AGENT_RUNTIME_HOST=0.0.0.0 NODE_ENV=production
ARG ADCRAFT_BUILD_COMMIT=unknown
ARG ADCRAFT_BUILD_VERSION=unknown
ARG ADCRAFT_BUILD_TIME=unknown
ARG ADCRAFT_BUILD_ENVIRONMENT=unknown
ARG ADCRAFT_BUILD_DIRTY=unknown
RUN node --input-type=module -e 'import fs from "node:fs"; const e=process.env; fs.writeFileSync("/app/adcraft-agent-build.json", JSON.stringify({commit:e.ADCRAFT_BUILD_COMMIT,version:e.ADCRAFT_BUILD_VERSION,buildTime:e.ADCRAFT_BUILD_TIME,environment:e.ADCRAFT_BUILD_ENVIRONMENT,dirty:e.ADCRAFT_BUILD_DIRTY==="true"?true:e.ADCRAFT_BUILD_DIRTY==="false"?false:null}));'
EXPOSE 8765
CMD ["node", "dist/src/main.js"]
