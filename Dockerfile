FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Install dependencies for building native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/* 

COPY package*.json ./
RUN npm ci

COPY . .

# ADD THIS: Dummy URL so Prisma Generate doesn't crash during build
ENV DATABASE_URL="file:./dev.db"

# Generate Prisma Client and build TypeScript
RUN npx prisma generate
RUN npm test

FROM node:24-bookworm-slim AS runner

WORKDIR /app

# Install sqlite dependencies
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/* 

# We need the production dependencies, or we can just copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/src/views ./src/views
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/docker-entrypoint.sh ./
RUN chmod +x /app/docker-entrypoint.sh

# Ensure the data directory exists and has correct permissions
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
# Update DATABASE_URL to point to a persistent volume
ENV DATABASE_URL="file:/app/data/prod.db"

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
