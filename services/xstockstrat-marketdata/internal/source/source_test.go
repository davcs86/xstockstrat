package source_test

import (
	"context"
	"testing"
	"time"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/source"
)

type stubClient struct{ name string }

func (s *stubClient) GetBars(_ context.Context, _, _ string, _, _ time.Time) ([]*marketdatav1.Bar, error) {
	return nil, nil
}
func (s *stubClient) GetLatestQuote(_ context.Context, _ string) (*marketdatav1.Quote, error) {
	return &marketdatav1.Quote{Source: s.name}, nil
}
func (s *stubClient) ListAssets(_ context.Context, _ string) ([]*commonv1.Asset, error) {
	return nil, nil
}
func (s *stubClient) StreamBars(_ context.Context, _ []string, _ string) (<-chan *marketdatav1.Bar, error) {
	return nil, nil
}
func (s *stubClient) StreamQuotes(_ context.Context, _ []string) (<-chan *marketdatav1.Quote, error) {
	return nil, nil
}

func TestRegistry_GetByName(t *testing.T) {
	reg := source.NewRegistry()
	reg.Register("alpaca", &stubClient{name: "alpaca"})

	c, err := reg.Get("alpaca")
	if err != nil {
		t.Fatalf("Get(alpaca): %v", err)
	}
	q, _ := c.GetLatestQuote(context.Background(), "AAPL")
	if q.Source != "alpaca" {
		t.Errorf("expected source alpaca, got %q", q.Source)
	}
}

func TestRegistry_GetDefault(t *testing.T) {
	reg := source.NewRegistry()
	reg.Register("alpaca", &stubClient{name: "alpaca"})

	c, err := reg.Get("")
	if err != nil {
		t.Fatalf("Get empty string should default to alpaca: %v", err)
	}
	q, _ := c.GetLatestQuote(context.Background(), "AAPL")
	if q.Source != "alpaca" {
		t.Errorf("expected alpaca default, got %q", q.Source)
	}
}

func TestRegistry_GetUnknown(t *testing.T) {
	reg := source.NewRegistry()
	reg.Register("alpaca", &stubClient{name: "alpaca"})

	_, err := reg.Get("polygon")
	if err == nil {
		t.Fatal("expected error for unknown source, got nil")
	}
}

func TestRegistry_DuplicatePanics(t *testing.T) {
	reg := source.NewRegistry()
	reg.Register("alpaca", &stubClient{name: "alpaca"})

	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic on duplicate registration")
		}
	}()
	reg.Register("alpaca", &stubClient{name: "alpaca2"})
}

func TestRegistry_MultipleProviders(t *testing.T) {
	reg := source.NewRegistry()
	reg.Register("alpaca", &stubClient{name: "alpaca"})
	reg.Register("polygon", &stubClient{name: "polygon"})

	c, err := reg.Get("polygon")
	if err != nil {
		t.Fatalf("Get(polygon): %v", err)
	}
	q, _ := c.GetLatestQuote(context.Background(), "AAPL")
	if q.Source != "polygon" {
		t.Errorf("expected polygon, got %q", q.Source)
	}
}
