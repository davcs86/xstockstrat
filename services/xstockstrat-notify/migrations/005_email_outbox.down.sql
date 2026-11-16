-- Migration: 005_email_outbox.down.sql
-- Service: xstockstrat-notify, feature notify-commsgun-channel. Both indexes are dropped together with the table.

DROP TABLE IF EXISTS notify.email_outbox;
