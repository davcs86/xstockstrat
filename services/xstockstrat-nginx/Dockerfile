FROM nginx:1.27-alpine

# Copy the nginx configuration from the repo root
COPY nginx.conf /etc/nginx/nginx.conf

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
