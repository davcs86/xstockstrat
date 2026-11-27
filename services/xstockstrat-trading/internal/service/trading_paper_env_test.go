package service

import (
	"context"
	"testing"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	"github.com/xstockstrat/trading/internal/config"
)

func paperEnvService(appEnv, tradingMode string, stored *bool) *TradingService {
	values := map[string]*configv1.ConfigValue{}
	if stored != nil {
		values["broker.paper"] = &configv1.ConfigValue{Value: &configv1.ConfigValue_BoolVal{BoolVal: *stored}}
	}
	return &TradingService{
		cfg:  &config.Config{ApplicationEnv: appEnv, TradingMode: tradingMode},
		cfgW: config.MustSnapshotWatcher("trading", values),
	}
}

func TestEnvironmentIsPaper_F321_AC4(t *testing.T) {
	yes, no := true, false
	const (
		paper = commonv1.TradingMode_TRADING_MODE_PAPER
		live  = commonv1.TradingMode_TRADING_MODE_LIVE
	)
	for _, tc := range []struct {
		name        string
		appEnv      string
		tradingMode string
		stored      *bool
		wantPaper   bool
		wantMode    commonv1.TradingMode
	}{
		{"production, TRADING_MODE paper, no row", "production", "paper", nil, false, live},
		{"development, TRADING_MODE live, no row", "development", "live", nil, true, paper},
		{"staging, TRADING_MODE live, no row", "staging", "live", nil, true, paper},
		{"APPLICATION_ENV unset, TRADING_MODE live, no row", "", "live", nil, true, paper},
		{"production seed false", "production", "", &no, false, live},
		{"staging seed true", "development", "", &yes, true, paper},
		{"stored true wins over production", "production", "paper", &yes, true, paper},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := paperEnvService(tc.appEnv, tc.tradingMode, tc.stored)
			if got := s.environmentIsPaper(); got != tc.wantPaper {
				t.Errorf("environmentIsPaper() = %v, want %v", got, tc.wantPaper)
			}
			if got := s.resolveTradingMode(commonv1.TradingMode_TRADING_MODE_UNSPECIFIED); got != tc.wantMode {
				t.Errorf("resolveTradingMode(UNSPECIFIED) = %v, want %v", got, tc.wantMode)
			}
			if got := s.GetTradingEnvironment(context.Background()).TradingMode; got != tc.wantMode {
				t.Errorf("GetTradingEnvironment().TradingMode = %v, want %v", got, tc.wantMode)
			}
		})
	}

	t.Run("explicit request mode wins", func(t *testing.T) {
		s := paperEnvService("development", "", nil)
		if got := s.resolveTradingMode(live); got != live {
			t.Errorf("resolveTradingMode(LIVE) = %v, want %v", got, live)
		}
	})
}
