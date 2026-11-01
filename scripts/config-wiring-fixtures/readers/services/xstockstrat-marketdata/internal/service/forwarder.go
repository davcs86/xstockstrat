package service

type intGetter interface {
	GetInt(key string, def int64) int64
}

func resolvePositiveInt(cfg intGetter, key string, def int64) int64 {
	if cfg == nil {
		return def
	}
	if v := cfg.GetInt(key, def); v > 0 {
		return v
	}
	return def
}

func backfillLimits(cfg intGetter) (int64, int64) {
	jobs := resolvePositiveInt(cfg, "marketdata.backfill.max_concurrent", 2)
	batch := resolvePositiveInt(
		cfg,
		backfillBatchKey,
		500,
	)
	return jobs, batch
}

const backfillBatchKey = "marketdata.backfill.batch_size"
