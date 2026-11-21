// Package alpacapace is the pure pacing arithmetic behind both Alpaca REST clients.
// Byte-identical in marketdata and trading (scripts/check-watcher-copies.py): no I/O, sleep, logging or randomness.
package alpacapace

import (
	"hash/maphash"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Operator-approved fixed invariants, not config keys (product-spec § Fixed Invariants).
const (
	Window        = 60 * time.Second
	ResetSlack    = 5 * time.Second
	LowWaterRatio = 10
	BackoffBase   = time.Second
	BackoffCap    = 8 * time.Second
	MaxJitter     = 500 * time.Millisecond
)

const (
	headerLimit     = "X-RateLimit-Limit"
	headerRemaining = "X-RateLimit-Remaining"
	headerReset     = "X-RateLimit-Reset"
)

// Key holds a fingerprint of the API key, never the key itself.
type Key struct {
	host string
	cred uint64
}

type Headers struct {
	Limit, Remaining int
	Reset            time.Time
}

// Reservation: a zero Wait is always sent; Fits is false only for a hold that ends after the caller's latest send time.
// Hold marks the wait of an exhausted window (a throttle), as opposed to a spread slot.
type Reservation struct {
	Wait time.Duration
	Fits bool
	Hold bool
}

type window struct {
	limit, remaining int
	headerReset      time.Time
	reset, nextSlot  time.Time
}

type Pacer struct {
	seed maphash.Seed

	mu      sync.Mutex
	windows map[Key]*window
	warned  map[Key]time.Time
}

// ParseHeaders is ok only when all three headers parse: a partial set must never change pacing state.
func ParseHeaders(h http.Header) (Headers, bool) {
	limit, err := strconv.Atoi(h.Get(headerLimit))
	if err != nil || limit <= 0 {
		return Headers{}, false
	}
	remaining, err := strconv.Atoi(h.Get(headerRemaining))
	if err != nil || remaining < 0 {
		return Headers{}, false
	}
	reset, ok := ParseReset(h)
	if !ok {
		return Headers{}, false
	}
	return Headers{Limit: limit, Remaining: remaining, Reset: reset}, true
}

func ParseReset(h http.Header) (time.Time, bool) {
	sec, err := strconv.ParseInt(h.Get(headerReset), 10, 64)
	if err != nil || sec <= 0 {
		return time.Time{}, false
	}
	return time.Unix(sec, 0), true
}

func NewPacer() *Pacer {
	return &Pacer{seed: maphash.MakeSeed(), windows: map[Key]*window{}, warned: map[Key]time.Time{}}
}

func (p *Pacer) Key(host, apiKey string) Key {
	return Key{host: host, cred: maphash.String(p.seed, apiKey)}
}

// Observe keeps the lower count within one reset and replaces state only when the reset advances,
// so a late response cannot hand back quota that in-flight requests already reserved.
func (p *Pacer) Observe(k Key, h Headers, now time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for key, w := range p.windows {
		if !w.reset.After(now) {
			delete(p.windows, key)
		}
	}
	if !h.Reset.After(now) || h.Reset.After(now.Add(Window+ResetSlack)) {
		return
	}
	prev := p.windows[k]
	if prev != nil && !h.Reset.After(prev.headerReset) {
		if h.Reset.Equal(prev.headerReset) && h.Remaining < prev.remaining {
			prev.remaining = h.Remaining
		}
		return
	}
	next := &window{limit: h.Limit, remaining: h.Remaining, headerReset: h.Reset, reset: h.Reset}
	if limit := now.Add(Window); next.reset.After(limit) {
		next.reset = limit
	}
	if prev != nil {
		next.nextSlot = prev.nextSlot
	}
	p.windows[k] = next
}

// Reserve takes latest with the caller's attempt allowance and this wait's jitter already subtracted,
// so a slot it commits can never fail the caller's fit check afterwards. A hold reserves nothing.
func (p *Pacer) Reserve(k Key, now, latest time.Time, jitter time.Duration) Reservation {
	p.mu.Lock()
	defer p.mu.Unlock()
	w := p.windows[k]
	if w == nil || !w.reset.After(now) {
		return Reservation{Fits: true}
	}
	if w.remaining == 0 {
		hold := min(w.reset.Sub(now), Window)
		return Reservation{Wait: hold + jitter, Fits: !now.Add(hold).After(latest), Hold: true}
	}
	if w.remaining*LowWaterRatio >= w.limit {
		w.remaining--
		return Reservation{Fits: true}
	}
	slot := now
	if w.nextSlot.After(now) {
		slot = w.nextSlot
	}
	if slot.After(now) && slot.After(latest) {
		w.remaining--
		return Reservation{Fits: true}
	}
	w.nextSlot = slot.Add(w.reset.Sub(slot) / time.Duration(w.remaining))
	w.remaining--
	if slot.Equal(now) {
		return Reservation{Fits: true}
	}
	return Reservation{Wait: slot.Sub(now) + jitter, Fits: true}
}

// WarnOnce is true once per throttled window per key; later calls stay false until now passes that window's until.
func (p *Pacer) WarnOnce(k Key, now, until time.Time) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if prev, ok := p.warned[k]; ok && !now.After(prev) {
		return false
	}
	p.warned[k] = until
	return true
}

// RetryWait applies no range filter to reset (that filter guards pacing state only); attempt counts from 1.
func RetryWait(attempt int, now, reset time.Time, jitter time.Duration) time.Duration {
	if reset.After(now) {
		return min(reset.Sub(now), Window) + jitter
	}
	wait := BackoffBase
	for i := 1; i < attempt && wait < BackoffCap; i++ {
		wait *= 2
	}
	return min(wait, BackoffCap) + jitter
}
