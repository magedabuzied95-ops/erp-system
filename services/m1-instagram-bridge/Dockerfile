FROM mcr.microsoft.com/playwright:v1.55.0-noble
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER root
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/services/m1-instagram-bridge
COPY services/m1-instagram-bridge/package*.json ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY services/m1-instagram-bridge/src ./src
COPY services/m1-instagram-bridge/scripts ./scripts
COPY services/shared ../shared
RUN mkdir -p /data/browser-profiles/instagram-test-account /data/diagnostics /data/state \
  && chown -R pwuser:pwuser /app /data
USER pwuser
EXPOSE 4090
CMD ["node", "src/index.js"]
