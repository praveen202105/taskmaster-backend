FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM dependencies AS build

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system --gid 1001 taskmaster \
  && useradd --system --uid 1001 --gid taskmaster --create-home taskmaster

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
RUN npm prune --omit=dev --ignore-scripts \
  && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY prisma ./prisma

RUN mkdir -p /app/uploads \
  && chown -R taskmaster:taskmaster /app

USER taskmaster
EXPOSE 3000
VOLUME ["/app/uploads"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
