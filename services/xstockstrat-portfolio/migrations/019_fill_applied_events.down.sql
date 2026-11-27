-- Migration: 019_fill_applied_events.down.sql
-- Service: xstockstrat-portfolio — reverses 019.

DROP TABLE IF EXISTS portfolio.consumer_floors;
DROP TABLE IF EXISTS portfolio.consumer_applied_events;
