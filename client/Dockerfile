# The BFF and the built SPA in one image: the BFF serves dist/, so the portal
# is a single origin and CORS never enters the picture.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
# tsx is a runtime dependency here — the BFF is executed as TypeScript rather
# than compiled, which keeps one source of truth for its ~250 lines.
RUN npm ci --omit=dev && npm install tsx@^4.19.2

COPY --from=build /app/dist ./dist
COPY server ./server
COPY tsconfig.json ./

# Unprivileged; the image holds no secrets, the API key arrives via env.
USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:8787/bff/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "server/index.ts"]
