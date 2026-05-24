FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate
COPY --from=builder /app/dist ./dist
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
