FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS tested

COPY tsconfig.json tsconfig.check.json ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test
RUN npm run check && npm run test:coverage

FROM tested AS built

RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=built /app/dist ./dist

USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
