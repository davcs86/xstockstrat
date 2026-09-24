package service

import (
	"testing"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// TestTifToWireString confirms the enum→broker-wire-string mapping (AC-1).
func TestTifToWireString(t *testing.T) {
	cases := map[tradingv1.TimeInForce]string{
		tradingv1.TimeInForce_TIME_IN_FORCE_DAY:         "day",
		tradingv1.TimeInForce_TIME_IN_FORCE_GTC:         "gtc",
		tradingv1.TimeInForce_TIME_IN_FORCE_IOC:         "ioc",
		tradingv1.TimeInForce_TIME_IN_FORCE_FOK:         "fok",
		tradingv1.TimeInForce_TIME_IN_FORCE_OPG:         "opg",
		tradingv1.TimeInForce_TIME_IN_FORCE_CLS:         "cls",
		tradingv1.TimeInForce_TIME_IN_FORCE_UNSPECIFIED: "day", // defense-in-depth belt
	}
	for tif, want := range cases {
		if got := tifToWireString(tif); got != want {
			t.Errorf("tifToWireString(%v) = %q, want %q", tif, got, want)
		}
	}
}

// TestValidateTIF_UNSPECIFIED_Rejected confirms the zero-value enum is rejected at the edge (AC-2).
func TestValidateTIF_UNSPECIFIED_Rejected(t *testing.T) {
	err := validateTIF(tradingv1.TimeInForce_TIME_IN_FORCE_UNSPECIFIED, commonv1.BrokerType_BROKER_TYPE_ALPACA)
	if err == nil {
		t.Fatal("validateTIF(UNSPECIFIED, ALPACA) = nil, want InvalidArgument")
	}
	if grpcstatus.Code(err) != codes.InvalidArgument {
		t.Errorf("code = %v, want InvalidArgument", grpcstatus.Code(err))
	}
	if got := grpcstatus.Convert(err).Message(); !containsField(got, "time_in_force") {
		t.Errorf("error message %q must name the field %q", got, "time_in_force")
	}
}

// TestValidateTIF_Valid_Alpaca confirms all six variants pass for Alpaca (AC-1).
func TestValidateTIF_Valid_Alpaca(t *testing.T) {
	for _, tif := range []tradingv1.TimeInForce{
		tradingv1.TimeInForce_TIME_IN_FORCE_DAY,
		tradingv1.TimeInForce_TIME_IN_FORCE_GTC,
		tradingv1.TimeInForce_TIME_IN_FORCE_IOC,
		tradingv1.TimeInForce_TIME_IN_FORCE_FOK,
		tradingv1.TimeInForce_TIME_IN_FORCE_OPG,
		tradingv1.TimeInForce_TIME_IN_FORCE_CLS,
	} {
		if err := validateTIF(tif, commonv1.BrokerType_BROKER_TYPE_ALPACA); err != nil {
			t.Errorf("validateTIF(%v, ALPACA) = %v, want nil", tif, err)
		}
	}
}

// TestValidateTIF_Unsupported_IBKR confirms IBKR rejects OPG and CLS before submission (AC-3).
func TestValidateTIF_Unsupported_IBKR(t *testing.T) {
	for _, tif := range []tradingv1.TimeInForce{
		tradingv1.TimeInForce_TIME_IN_FORCE_OPG,
		tradingv1.TimeInForce_TIME_IN_FORCE_CLS,
	} {
		err := validateTIF(tif, commonv1.BrokerType_BROKER_TYPE_IBKR)
		if err == nil {
			t.Errorf("validateTIF(%v, IBKR) = nil, want InvalidArgument", tif)
			continue
		}
		if grpcstatus.Code(err) != codes.InvalidArgument {
			t.Errorf("validateTIF(%v, IBKR) code = %v, want InvalidArgument", tif, grpcstatus.Code(err))
		}
	}
}

// TestValidateTIF_Valid_IBKR confirms DAY/GTC/IOC/FOK pass for IBKR.
func TestValidateTIF_Valid_IBKR(t *testing.T) {
	for _, tif := range []tradingv1.TimeInForce{
		tradingv1.TimeInForce_TIME_IN_FORCE_DAY,
		tradingv1.TimeInForce_TIME_IN_FORCE_GTC,
		tradingv1.TimeInForce_TIME_IN_FORCE_IOC,
		tradingv1.TimeInForce_TIME_IN_FORCE_FOK,
	} {
		if err := validateTIF(tif, commonv1.BrokerType_BROKER_TYPE_IBKR); err != nil {
			t.Errorf("validateTIF(%v, IBKR) = %v, want nil", tif, err)
		}
	}
}

// TestValidateTIF_Offline confirms all six variants pass for OFFLINE accounts.
func TestValidateTIF_Offline(t *testing.T) {
	for _, tif := range []tradingv1.TimeInForce{
		tradingv1.TimeInForce_TIME_IN_FORCE_DAY,
		tradingv1.TimeInForce_TIME_IN_FORCE_GTC,
		tradingv1.TimeInForce_TIME_IN_FORCE_IOC,
		tradingv1.TimeInForce_TIME_IN_FORCE_FOK,
		tradingv1.TimeInForce_TIME_IN_FORCE_OPG,
		tradingv1.TimeInForce_TIME_IN_FORCE_CLS,
	} {
		if err := validateTIF(tif, commonv1.BrokerType_BROKER_TYPE_OFFLINE); err != nil {
			t.Errorf("validateTIF(%v, OFFLINE) = %v, want nil", tif, err)
		}
	}
}

func containsField(msg, field string) bool {
	for i := 0; i+len(field) <= len(msg); i++ {
		if msg[i:i+len(field)] == field {
			return true
		}
	}
	return false
}
