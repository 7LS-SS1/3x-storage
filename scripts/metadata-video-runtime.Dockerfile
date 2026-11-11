# Isolated synthetic-media verification; no app database or storage credentials.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
RUN npm install --no-audit --no-fund typescript@5.9.3 @nestjs/common@11.1.11 reflect-metadata@0.2.2 rxjs@7.8.2 sharp@0.35.2 @aws-sdk/client-s3@3.1096.0 @aws-sdk/s3-request-presigner@3.1096.0
ENV NODE_PATH=/runner/node_modules
WORKDIR /workspace
CMD ["node", "scripts/metadata-video-runtime-test.cjs"]
