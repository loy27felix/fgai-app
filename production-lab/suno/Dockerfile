FROM mcr.microsoft.com/playwright:v1.61.1-noble
WORKDIR /app
ARG BUILD_COMMIT=unknown
ARG BUILD_VERSION=unknown
ARG BUILD_TIME=unknown
ARG BUILD_ENVIRONMENT=unknown
ARG BUILD_DIRTY=unknown
ENV BUILD_COMMIT=$BUILD_COMMIT BUILD_VERSION=$BUILD_VERSION BUILD_TIME=$BUILD_TIME BUILD_ENVIRONMENT=$BUILD_ENVIRONMENT BUILD_DIRTY=$BUILD_DIRTY
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . ./
RUN node --test *.test.mjs
RUN node --import tsx -e "import('./vendor/SunoApi.ts').then(()=>console.log('Suno library imports successfully'))"
ENV BROWSER=chromium BROWSER_HEADLESS=true BROWSER_DISABLE_GPU=true BROWSER_GHOST_CURSOR=false BROWSER_LOCALE=en
EXPOSE 3050
CMD ["node", "--import", "tsx", "server.ts"]
