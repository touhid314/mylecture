# Render worker image for TTS + video rendering.
# Kokoro model assets under models/ must be present at runtime (mounted volume
# or downloaded into the image) for narration to work.

FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages python-dotenv

# Kokoro via kokoro-js (npm). Set KOKORO_ENGINE=kokoro-js in .env — same as local dev.
# Only install misaki/onnxruntime if you switch KOKORO_ENGINE to onnxruntime.

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages ./packages

RUN npm install

COPY . .

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright && npx playwright install --with-deps chromium

RUN groupadd --system renderworker \
    && useradd --system --gid renderworker --home-dir /app renderworker \
    && chown -R renderworker:renderworker /app /ms-playwright

USER renderworker

ENV PORT=8787
EXPOSE 8787

CMD ["npm", "run", "render:server"]
