package config

type snapshot struct{ values map[string]any }

func writes(values map[string]any, cfg *snapshot, k string, x any) any {
	values[k] = x
	cfg.values["marketdata.feed.enabled"] = true
	v := values["marketdata.feed.symbols"]
	return v
}
