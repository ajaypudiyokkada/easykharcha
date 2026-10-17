# Build context is the repo root (see docker-compose.prod.yml) — this image needs
# scripts/patch_web_shell.mjs, which `npm run build:web` (root package.json) always runs straight
# after the Expo export itself; there's no Expo-native way to hook that patch in from inside mobile/.
FROM node:20-slim AS build

ENV NODE_OPTIONS=--max-old-space-size=1536

WORKDIR /app

COPY mobile/package.json mobile/package-lock.json mobile/
RUN npm --prefix mobile ci

COPY mobile/ mobile/
COPY scripts/patch_web_shell.mjs scripts/patch_web_shell.mjs

ARG EXPO_PUBLIC_API_URL=https://api.easykharcha.com
ARG EXPO_PUBLIC_LANDING_URL=https://easykharcha.com
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL} \
    EXPO_PUBLIC_LANDING_URL=${EXPO_PUBLIC_LANDING_URL}

RUN npm --prefix mobile run build:web \
    && node scripts/patch_web_shell.mjs

FROM nginx:1.27-alpine

COPY mobile/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/mobile/dist /usr/share/nginx/html

EXPOSE 80
