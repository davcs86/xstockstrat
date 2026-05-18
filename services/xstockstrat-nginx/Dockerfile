FROM nginx:1.27-alpine

# envsubst (used by docker-entrypoint.sh) lives in gettext
RUN apk add --no-cache gettext

# Copy nginx config as a template; docker-entrypoint.sh renders it at container start
COPY nginx.conf /etc/nginx/nginx.conf.template
COPY services/xstockstrat-nginx/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
