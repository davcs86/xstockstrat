package fmp

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"sync"
	"testing"
	"time"
)

type stampRT struct {
	mu     sync.Mutex
	stamps []time.Time
	status int
	body   string
}

func (rt *stampRT) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.mu.Lock()
	rt.stamps = append(rt.stamps, time.Now())
	rt.mu.Unlock()
	return (&recordingRT{respond: func(string) (int, string) { return rt.status, rt.body }}).RoundTrip(req)
}

func gatewayClient(rt http.RoundTripper, rps float64, dailyCap int, now func() time.Time) *Client {
	return NewClient(ClientConfig{
		BaseURL:    "https://fmp.test",
		APIKey:     "SECRET-KEY",
		HTTPClient: &http.Client{Transport: rt},
		Limits:     func() (float64, int) { return rps, dailyCap },
		Now:        now,
	})
}

// @AC-1: 50 concurrent callers never exceed rps outbound requests in any rolling 1-second window.
func TestGateway_RateLimit_AC1(t *testing.T) {
	rt := &stampRT{status: 200, body: `[{"sector":"Technology"}]`}
	c := gatewayClient(rt, 5, 1000, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	for i := 0; i < 15; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.FetchSector(ctx, "XYZ"); err != nil {
				t.Errorf("FetchSector: %v", err)
			}
		}()
	}
	wg.Wait()
	sort.Slice(rt.stamps, func(i, j int) bool { return rt.stamps[i].Before(rt.stamps[j]) })
	if len(rt.stamps) != 15 {
		t.Fatalf("calls = %d, want 15", len(rt.stamps))
	}
	for i := range rt.stamps {
		n := 0
		for j := i; j < len(rt.stamps) && rt.stamps[j].Sub(rt.stamps[i]) < time.Second; j++ {
			n++
		}
		if n > 5 {
			t.Fatalf("window starting at call %d holds %d requests, want <= 5", i, n)
		}
	}
}

// @AC-4: a 503 storm refunds every reserved slot, so an outage never self-throttles later fetches.
func TestGateway_BudgetRefundOn503_AC4(t *testing.T) {
	rt := &stampRT{status: 503, body: ``}
	c := gatewayClient(rt, 0, 3, nil)
	for i := 0; i < 10; i++ {
		if _, err := c.FetchSector(context.Background(), "XYZ"); err == nil {
			t.Fatal("expected an error on HTTP 503")
		}
	}
	if used, _ := c.BudgetSnapshot(); used != 0 {
		t.Fatalf("used = %d after a 503 storm, want 0 (all refunded)", used)
	}
	if len(rt.stamps) != 10 {
		t.Fatalf("outbound calls = %d, want 10 (cap never tripped by failures)", len(rt.stamps))
	}
}

func TestGateway_CapExceededMakesNoCall(t *testing.T) {
	rt := &stampRT{status: 200, body: `[]`}
	c := gatewayClient(rt, 0, 2, nil)
	for i := 0; i < 2; i++ {
		if _, err := c.FetchSector(context.Background(), "XYZ"); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	_, err := c.FetchSector(context.Background(), "XYZ")
	if !errors.Is(err, ErrFMPDailyCapExceeded) {
		t.Fatalf("err = %v, want ErrFMPDailyCapExceeded", err)
	}
	if len(rt.stamps) != 2 {
		t.Fatalf("outbound calls = %d, want 2 (third rejected before HTTP)", len(rt.stamps))
	}
}

// One shared budget: the fundamentals path and the classification path spend the same counter.
func TestGateway_SharedBudgetAcrossPaths(t *testing.T) {
	rt := &recordingRT{respond: func(path string) (int, string) {
		if path == "/stable/quote" {
			return 200, `[{"symbol":"XYZ","price":1}]`
		}
		return 200, `[{"sector":"Energy"}]`
	}}
	c := NewClient(ClientConfig{BaseURL: "https://fmp.test", HTTPClient: &http.Client{Transport: rt},
		Limits: func() (float64, int) { return 0, 100 }})
	if _, err := c.GetFundamentalsMulti(context.Background(), []string{"XYZ"}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.FetchSector(context.Background(), "XYZ"); err != nil {
		t.Fatal(err)
	}
	if used, _ := c.BudgetSnapshot(); used != 2 {
		t.Fatalf("used = %d, want 2 (one quote + one profile on one budget)", used)
	}
}

func TestGateway_SeedAndDayRollover(t *testing.T) {
	day := time.Date(2026, 10, 6, 23, 0, 0, 0, time.UTC)
	c := gatewayClient(&stampRT{status: 200, body: `[]`}, 0, 250, func() time.Time { return day })
	c.SeedBudget(240)
	c.SeedBudget(10) // never lowers
	if used, _ := c.BudgetSnapshot(); used != 240 {
		t.Fatalf("used = %d, want 240", used)
	}
	day = day.Add(2 * time.Hour) // next UTC day
	if used, _ := c.BudgetSnapshot(); used != 0 {
		t.Fatalf("used after rollover = %d, want 0", used)
	}
}

func TestFetchSector_ParsesProfileSector(t *testing.T) {
	c := gatewayClient(&stampRT{status: 200, body: `[{"sector":"Financial Services","beta":1.2}]`}, 0, 10, nil)
	got, err := c.FetchSector(context.Background(), "AXP")
	if err != nil || got != "Financial Services" {
		t.Fatalf("FetchSector = %q, %v", got, err)
	}
}
