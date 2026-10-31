# Production image for the Fastify API (used by Cloud Run, runs anywhere Docker does).
# Build from the backend folder: docker build -t autoflow-api backend
FROM node:25-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

FROM node:25-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
# Cloud Run sets PORT; the API reads it and listens on 0.0.0.0.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/src/index.js"]
