-- Migration: 027_contract_owner_dimension.down.sql
DO $$ BEGIN
  RAISE EXCEPTION 'irreversible contract: analysis 027 dropped analysis.strategy_scores and set backtest_runs.user_id NOT NULL; recover with migrate force 25 then db-migrate.sh up';
END $$;
