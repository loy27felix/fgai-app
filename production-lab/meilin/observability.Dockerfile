FROM node:20-alpine AS build
WORKDIR /source
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY lib ./lib
COPY scripts/observability-server.ts ./scripts/observability-server.ts
RUN node -e 'const {createRequire}=require("node:module"); const {build}=createRequire(require.resolve("tsx"))("esbuild"); build({entryPoints:["scripts/observability-server.ts"],outfile:"/out/observability-server.cjs",bundle:true,platform:"node",target:"node20",format:"cjs",external:["pg"],metafile:true}).then(result=>{if(Object.keys(result.metafile.inputs).some(path=>path.includes("node_modules/next/")))throw Error("unexpected Next runtime");}).catch(error=>{console.error(error);process.exitCode=1;});'

FROM node:20-alpine
WORKDIR /app
COPY production-lab/meilin/gateway/package.json production-lab/meilin/gateway/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /out/observability-server.cjs ./observability-server.cjs
ENV NODE_ENV=production FG_RUNTIME_TARGET=native
USER node
EXPOSE 3013
CMD ["node", "observability-server.cjs"]
