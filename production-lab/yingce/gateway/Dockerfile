FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY *.mjs *.sql *.json ./
COPY protocol-packages ./protocol-packages
RUN node policy.test.mjs && node host-metrics.test.mjs && node fg-adcraft.test.mjs && node --test fg-adcraft-retention.test.mjs fg-creator-protocol.test.mjs
USER node
EXPOSE 3010
CMD ["node", "server.mjs"]
