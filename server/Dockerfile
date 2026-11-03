FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY scripts ./scripts
COPY admin-dist ./admin-dist

ENV NODE_ENV=production
ENV PORT=3100
ENV ADMIN_DIST=/app/admin-dist
ENV DATABASE_URL=file:/data/prod.db

EXPOSE 3100

VOLUME ["/data", "/app/uploads"]

CMD ["sh", "-c", "npx prisma db push --skip-generate && node src/index.js"]
