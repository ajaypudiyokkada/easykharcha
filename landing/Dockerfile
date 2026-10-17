# Self-contained build context: landing/ (see docker-compose.prod.yml). index.html itself stays
# untouched — SIGNUP_URL/LOGIN_URL keep their localhost dev defaults in the committed file (see
# README's "Two sites, two URLs" section) and are only swapped for the real app URL here, at image
# build time, via a build arg.
FROM nginx:1.27-alpine

ARG APP_URL=https://app.easykharcha.com

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY assets /usr/share/nginx/html/assets

RUN sed -i "s#http://localhost:8081#${APP_URL}#g" /usr/share/nginx/html/index.html

EXPOSE 80
