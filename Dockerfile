# ── Stage 1: build ───────────────────────────────────────────────────
# Vite 的 VITE_* 环境变量在构建期注入（打进静态产物），运行期改配置需重新构建。
# 不传 ARG 也能正常构建：Planka 集成缺省自动停用，其余功能全部本地运行。
FROM node:22-alpine AS build
WORKDIR /app

# 可选：部署期 Planka 集成（build args）
ARG VITE_PLANKA_URL=""
ARG VITE_PLANKA_TOKEN=""
ARG VITE_PLANKA_BOARD_ID=""
ARG VITE_PLANKA_LIST_ID=""
ENV VITE_PLANKA_URL=$VITE_PLANKA_URL \
    VITE_PLANKA_TOKEN=$VITE_PLANKA_TOKEN \
    VITE_PLANKA_BOARD_ID=$VITE_PLANKA_BOARD_ID \
    VITE_PLANKA_LIST_ID=$VITE_PLANKA_LIST_ID

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: serve ───────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
