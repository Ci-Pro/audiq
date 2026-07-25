FROM oven/bun:1-alpine

# Install system dependencies: python3 + pip for yt-dlp, ffmpeg for audio/video processing
RUN apk add --no-cache python3 py3-pip ffmpeg

# Install yt-dlp via pip
RUN pip3 install --break-system-packages yt-dlp

WORKDIR /app

# Install app dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY index.ts ./

# Create download directory
RUN mkdir -p /app/downloads /app/status

# Zeabur injects PORT automatically; 8080 as default fallback
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "index.ts"]
