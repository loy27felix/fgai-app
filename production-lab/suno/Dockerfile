FROM mcr.microsoft.com/playwright:v1.61.1-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . ./
RUN node --test contract.test.mjs
RUN node --import tsx -e "import('./vendor/SunoApi.ts').then(()=>console.log('Suno library imports successfully'))"
ENV BROWSER=chromium BROWSER_HEADLESS=true BROWSER_DISABLE_GPU=true BROWSER_GHOST_CURSOR=false BROWSER_LOCALE=en
EXPOSE 3050
CMD ["node", "--import", "tsx", "server.ts"]
