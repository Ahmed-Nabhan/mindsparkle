# Cloud Run worker for Supabase processing_queue
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

# Needed for PPTX slide previews: convert PPTX -> PDF (soffice headless)
RUN apt-get update && apt-get install -y --no-install-recommends \
		libreoffice-impress \
		libreoffice-core \
		libreoffice-common \
		fonts-dejavu-core \
		fonts-liberation \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

CMD ["node", "dist/worker.js"]
