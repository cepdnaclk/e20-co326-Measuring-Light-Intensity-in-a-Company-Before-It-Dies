FROM node:20

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
COPY server/ ./server/

# Ensure npm exists across base-image variants.
RUN sh -c "command -v npm >/dev/null 2>&1 || ( \
  (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install -y --no-install-recommends npm && rm -rf /var/lib/apt/lists/*) || \
  (command -v apk >/dev/null 2>&1 && apk add --no-cache npm) \
)"
RUN npm install --prefix server --omit=dev --no-audit --no-fund

EXPOSE 4000

CMD ["node", "server/src/index.js"]
