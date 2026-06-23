# Render worker image for TTS + video rendering.
# Kokoro model assets under models/ must be present at runtime (mounted volume
# or downloaded into the image) for narration to work.

FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages ./packages

RUN npm install

COPY . .

RUN npx playwright install --with-deps chromium

ENV PORT=8787
EXPOSE 8787

CMD ["npm", "run", "render:server"]
