FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY *.mjs *.sql *.json ./
COPY shared ./shared
COPY protocol-packages ./protocol-packages
ARG BUILD_VERSION=dev
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
ARG BUILD_DIRTY=unknown
ENV NODE_ENV=production \
    YINGCE_GATEWAY_BUILD_VERSION=${BUILD_VERSION} \
    YINGCE_GATEWAY_BUILD_COMMIT=${BUILD_COMMIT} \
    YINGCE_GATEWAY_BUILD_TIME=${BUILD_TIME} \
    YINGCE_GATEWAY_BUILD_DIRTY=${BUILD_DIRTY}
RUN node --test *.test.mjs
USER node
EXPOSE 3010
CMD ["node", "server.mjs"]
