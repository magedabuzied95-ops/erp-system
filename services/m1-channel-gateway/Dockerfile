FROM node:22-alpine AS dependencies
WORKDIR /app/services/m1-channel-gateway
COPY services/m1-channel-gateway/package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/services/m1-channel-gateway
COPY --from=dependencies /app/services/m1-channel-gateway/node_modules ./node_modules
COPY services/m1-channel-gateway/package*.json ./
COPY services/m1-channel-gateway/src ./src
COPY services/m1-channel-gateway/migrations ./migrations
COPY services/shared ../shared
USER node
EXPOSE 4080
CMD ["node", "src/index.js"]
