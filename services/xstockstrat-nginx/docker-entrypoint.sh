#!/bin/sh
# Entrypoint for xstockstrat-nginx container.
# Substitutes DO private service URLs into nginx.conf using envsubst, then starts nginx.
set -e

# XSTOCKSTRAT_*_PRIVATE_URL vars hold bare hostnames (from PRIVATE_DOMAIN on DO, container names
# in Compose). The nginx template appends :PORT itself, so PRIVATE_URL must NOT be used — it
# includes the port and would produce double ports (e.g. svc:3000:3000). Strip any accidental
# protocol prefix defensively.
TRADER_UPSTREAM="${XSTOCKSTRAT_TRADER_PRIVATE_URL#http://}"
TRADER_UPSTREAM="${TRADER_UPSTREAM#https://}"
export TRADER_UPSTREAM

INSIGHTS_UPSTREAM="${XSTOCKSTRAT_INSIGHTS_PRIVATE_URL#http://}"
INSIGHTS_UPSTREAM="${INSIGHTS_UPSTREAM#https://}"
export INSIGHTS_UPSTREAM

CONFIG_UI_UPSTREAM="${XSTOCKSTRAT_CONFIG_UI_PRIVATE_URL#http://}"
CONFIG_UI_UPSTREAM="${CONFIG_UI_UPSTREAM#https://}"
export CONFIG_UI_UPSTREAM

AGENT_UPSTREAM="${XSTOCKSTRAT_AGENT_PRIVATE_URL#http://}"
AGENT_UPSTREAM="${AGENT_UPSTREAM#https://}"
export AGENT_UPSTREAM

# Substitute only the upstream variables; leave nginx's own $variables untouched.
envsubst '$TRADER_UPSTREAM $INSIGHTS_UPSTREAM $CONFIG_UI_UPSTREAM $AGENT_UPSTREAM' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/nginx.conf

nginx -t
exec nginx -g 'daemon off;'
