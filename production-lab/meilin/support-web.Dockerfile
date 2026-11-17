FROM node:20-alpine AS build
WORKDIR /source
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY lib ./lib
COPY scripts/support-bot-web-server.ts ./scripts/support-bot-web-server.ts
RUN node -e 'const {createRequire}=require("node:module"); const {build}=createRequire(require.resolve("tsx"))("esbuild"); build({entryPoints:["scripts/support-bot-web-server.ts"],outfile:"/out/support-web-server.cjs",bundle:true,platform:"node",target:"node20",format:"cjs",external:["pg"],metafile:true}).then(result=>{if(Object.keys(result.metafile.inputs).some(path=>path.includes("node_modules/next/")))throw Error("unexpected Next runtime");}).catch(error=>{console.error(error);process.exitCode=1;});'

FROM node:20-alpine
WORKDIR /app
COPY production-lab/meilin/gateway/package.json production-lab/meilin/gateway/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /out/support-web-server.cjs ./support-web-server.cjs
ENV NODE_ENV=production
USER node
EXPOSE 3012
CMD ["node", "support-web-server.cjs"]
