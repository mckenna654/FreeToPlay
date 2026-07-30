FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for building native modules (like better-sqlite3)
RUN apk add --no-cache python3 make g++ 

COPY package*.json ./
RUN npm ci

COPY . .

# ADD THIS: Dummy URL so Prisma Generate doesn't crash during build
ENV DATABASE_URL="file:./dev.db"

# Generate Prisma Client and build TypeScript
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

# Install dependencies for running sqlite
RUN apk add --no-cache python3 make g++ 

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
