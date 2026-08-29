-- Migration: 002_push_subscriptions.down.sql
-- Service: xstockstrat-notify
-- Reverses 002_push_subscriptions.up.sql. The index is dropped together with the table.

DROP TABLE IF EXISTS notify.push_subscriptions;
