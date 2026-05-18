#!/bin/sh
# Entrypoint for xstockstrat-nginx container.
# Substitutes DO private service URLs into nginx.conf using envsubst, then starts nginx.
set -e

# Strip protocol prefix from DO PRIVATE_URL values (e.g. "http://svc.internal" -> "svc.internal")
# In docker-compose these are plain container names (no prefix to strip).
TRADER_UPSTREAM="${XSTOCKSTRAT_TRADER_PRIVATE_URL#http://}"
TRADER_UPSTREAM="${TRADER_UPSTREAM#https://}"
export TRADER_UPSTREAM

INSIGHTS_UPSTREAM="${XSTOCKSTRAT_INSIGHTS_PRIVATE_URL#http://}"
INSIGHTS_UPSTREAM="${INSIGHTS_UPSTREAM#https://}"
export INSIGHTS_UPSTREAM

CONFIG_UI_UPSTREAM="${XSTOCKSTRAT_CONFIG_UI_PRIVATE_URL#http://}"
CONFIG_UI_UPSTREAM="${CONFIG_UI_UPSTREAM#https://}"
export CONFIG_UI_UPSTREAM

# Substitute only the three upstream variables; leave nginx's own $variables untouched.
envsubst '$TRADER_UPSTREAM $INSIGHTS_UPSTREAM $CONFIG_UI_UPSTREAM' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/nginx.conf

nginx -t
exec nginx -g 'daemon off;'
