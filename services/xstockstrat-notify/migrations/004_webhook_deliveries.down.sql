-- Migration: 004_webhook_deliveries.down.sql
-- Service: xstockstrat-notify, feature webhook-fanout-callback. The index is dropped together with the table.

DROP TABLE IF EXISTS notify.webhook_deliveries;
