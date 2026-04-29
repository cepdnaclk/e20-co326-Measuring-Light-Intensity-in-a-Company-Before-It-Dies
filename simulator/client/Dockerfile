FROM node:20 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
COPY client/ ./client/

# Ensure npm exists across base-image variants.
RUN sh -c "command -v npm >/dev/null 2>&1 || ( \
  (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install -y --no-install-recommends npm && rm -rf /var/lib/apt/lists/*) || \
  (command -v apk >/dev/null 2>&1 && apk add --no-cache npm) \
)"
RUN npm install --prefix client --no-audit --no-fund
RUN npm run build --prefix client

FROM nginx:alpine
COPY --from=builder /app/client/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
