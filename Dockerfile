# Render worker image for TTS + video rendering.
FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages python-dotenv

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
