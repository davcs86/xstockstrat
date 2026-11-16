package alpacapace

import (
	"net/http"
	"strconv"
	"testing"
	"time"
)

var t0 = time.Unix(1_800_000_000, 0)

const testHost = "data.alpaca.markets"

func unixSeconds(t time.Time) string { return strconv.FormatInt(t.Unix(), 10) }

func rateHeaders(limit, remaining, reset string) http.Header {
	h := http.Header{}
	for name, v := range map[string]string{
		"X-RateLimit-Limit":     limit,
		"X-RateLimit-Remaining": remaining,
		"X-RateLimit-Reset":     reset,
	} {
		if v != "" {
			h.Set(name, v)
		}
	}
	return h
}

func observedPacer(limit, remaining int, reset time.Time) (*Pacer, Key) {
	p := NewPacer()
	k := p.Key(testHost, "KEY-A")
	p.Observe(k, Headers{Limit: limit, Remaining: remaining, Reset: reset}, t0)
	return p, k
}

func stateOf(t *testing.T, p *Pacer, k Key) *window {
	t.Helper()
	w := p.windows[k]
	if w == nil {
		t.Fatalf("no pacing state recorded for the key")
	}
	return w
}

func wantReservation(t *testing.T, got Reservation, wait time.Duration, fits bool) {
	t.Helper()
	if got.Wait != wait || got.Fits != fits {
		t.Fatalf("Reserve = {Wait: %v, Fits: %v}, want {Wait: %v, Fits: %v}", got.Wait, got.Fits, wait, fits)
	}
}

func TestParseHeaders(t *testing.T) {
	reset := unixSeconds(t0.Add(30 * time.Second))
	got, ok := ParseHeaders(rateHeaders("200", "4", reset))
	if !ok || got.Limit != 200 || got.Remaining != 4 || !got.Reset.Equal(t0.Add(30*time.Second)) {
		t.Fatalf("ParseHeaders = %+v, %v; want 200/4/reset, true", got, ok)
	}
	if _, ok := ParseHeaders(rateHeaders("200", "0", reset)); !ok {
		t.Fatalf("Remaining 0 must parse")
	}
	for name, h := range map[string]http.Header{
		"no headers":          {},
		"missing limit":       rateHeaders("", "4", reset),
		"missing remaining":   rateHeaders("200", "", reset),
		"missing reset":       rateHeaders("200", "4", ""),
		"non-numeric limit":   rateHeaders("many", "4", reset),
		"non-numeric remain":  rateHeaders("200", "abc", reset),
		"non-numeric reset":   rateHeaders("200", "4", "soon"),
		"limit zero":          rateHeaders("0", "0", reset),
		"negative remaining":  rateHeaders("200", "-1", reset),
		"reset zero":          rateHeaders("200", "4", "0"),
		"negative reset":      rateHeaders("200", "4", "-5"),
		"limit with fraction": rateHeaders("200.5", "4", reset),
	} {
		if got, ok := ParseHeaders(h); ok {
			t.Errorf("%s: ParseHeaders = %+v, true; want not ok", name, got)
		}
	}
}

func TestParseReset_ResetAlone(t *testing.T) {
	got, ok := ParseReset(rateHeaders("", "", unixSeconds(t0.Add(2*time.Second))))
	if !ok || !got.Equal(t0.Add(2*time.Second)) {
		t.Fatalf("ParseReset = %v, %v; want reset, true", got, ok)
	}
	for _, v := range []string{"", "abc", "0", "-1"} {
		if _, ok := ParseReset(rateHeaders("", "", v)); ok {
			t.Errorf("ParseReset(%q) ok; want not ok", v)
		}
	}
}

func TestReserve_NoStateOrExpiredWindowSendsAtOnce(t *testing.T) {
	p := NewPacer()
	k := p.Key(testHost, "KEY-A")
	wantReservation(t, p.Reserve(k, t0, t0.Add(30*time.Second), 0), 0, true)
	if len(p.windows) != 0 {
		t.Fatalf("a Reserve with no state recorded %d windows", len(p.windows))
	}

	p, k = observedPacer(200, 0, t0.Add(time.Second))
	later := t0.Add(2 * time.Second)
	wantReservation(t, p.Reserve(k, later, later.Add(30*time.Second), 400*time.Millisecond), 0, true)
	if w := stateOf(t, p, k); w.remaining != 0 || !w.nextSlot.IsZero() {
		t.Fatalf("an expired window was changed by Reserve: %+v", w)
	}
}

func TestReserve_AboveLowWaterSendsAtOnce(t *testing.T) {
	p, k := observedPacer(200, 150, t0.Add(30*time.Second))
	wantReservation(t, p.Reserve(k, t0, t0.Add(30*time.Second), 400*time.Millisecond), 0, true)
	if got := stateOf(t, p, k).remaining; got != 149 {
		t.Fatalf("local remaining = %d, want 149", got)
	}
	// 20 of 200 is exactly the low-water boundary and is not low.
	p, k = observedPacer(200, 20, t0.Add(30*time.Second))
	wantReservation(t, p.Reserve(k, t0, t0.Add(30*time.Second), 0), 0, true)
	if w := stateOf(t, p, k); !w.nextSlot.IsZero() {
		t.Fatalf("a request above low-water reserved a slot: %+v", w)
	}
}

func TestReserve_SpreadsALowRemainingCount(t *testing.T) {
	p, k := observedPacer(200, 4, t0.Add(4*time.Second))
	latest := t0.Add(30 * time.Second)
	for i, want := range []time.Duration{0, time.Second, 2 * time.Second, 3 * time.Second} {
		got := p.Reserve(k, t0, latest, 0)
		if got.Wait != want || !got.Fits {
			t.Fatalf("request %d: Reserve = %+v, want {%v true}", i+1, got, want)
		}
	}
	if got := stateOf(t, p, k).remaining; got != 0 {
		t.Fatalf("local remaining after 4 reservations = %d, want 0", got)
	}
}

func TestReserve_SlotTheCallerCannotWaitForIsSentAtOnce(t *testing.T) {
	p, k := observedPacer(200, 4, t0.Add(4*time.Second))
	wantReservation(t, p.Reserve(k, t0, t0.Add(30*time.Second), 0), 0, true)
	slot := stateOf(t, p, k).nextSlot
	if !slot.Equal(t0.Add(time.Second)) {
		t.Fatalf("next slot = %v, want 1 s after now", slot.Sub(t0))
	}

	wantReservation(t, p.Reserve(k, t0, t0.Add(500*time.Millisecond), 400*time.Millisecond), 0, true)
	w := stateOf(t, p, k)
	if w.remaining != 2 || !w.nextSlot.Equal(slot) {
		t.Fatalf("after a skip: remaining = %d, next slot = %v; want 2 and unchanged", w.remaining, w.nextSlot.Sub(t0))
	}

	wantReservation(t, p.Reserve(k, t0, t0.Add(30*time.Second), 0), time.Second, true)
}

func TestReserve_ExhaustedWindowHoldsUntilReset(t *testing.T) {
	const jitter = 250 * time.Millisecond
	reset := t0.Add(3 * time.Second)
	p, k := observedPacer(200, 0, reset)

	wantReservation(t, p.Reserve(k, t0, reset, jitter), 3*time.Second+jitter, true)
	wantReservation(t, p.Reserve(k, t0, t0.Add(30*time.Second), jitter), 3*time.Second+jitter, true)
	wantReservation(t, p.Reserve(k, t0, reset.Add(-time.Nanosecond), jitter), 3*time.Second+jitter, false)

	if w := stateOf(t, p, k); w.remaining != 0 || !w.nextSlot.IsZero() {
		t.Fatalf("a hold reserved something: %+v", w)
	}
}

func TestReserve_ZeroWaitIsNeverFitTested(t *testing.T) {
	past := t0.Add(-time.Hour)

	p := NewPacer()
	wantReservation(t, p.Reserve(p.Key(testHost, "KEY-A"), t0, past, 400*time.Millisecond), 0, true)

	p, k := observedPacer(200, 150, t0.Add(30*time.Second))
	wantReservation(t, p.Reserve(k, t0, past, 400*time.Millisecond), 0, true)

	p, k = observedPacer(200, 4, t0.Add(4*time.Second))
	wantReservation(t, p.Reserve(k, t0, past, 400*time.Millisecond), 0, true)
	if got := stateOf(t, p, k).remaining; got != 3 {
		t.Fatalf("first low-water slot: local remaining = %d, want 3", got)
	}
}

// The client passes latest with the jitter already subtracted, so a committed slot always fits.
func TestReserve_SlotInsideTheJitterMarginIsSkippedNotFailed(t *testing.T) {
	const jitter = 400 * time.Millisecond
	deadline := t0.Add(1200 * time.Millisecond)
	p, k := observedPacer(200, 4, t0.Add(4*time.Second))
	wantReservation(t, p.Reserve(k, t0, t0.Add(30*time.Second), 0), 0, true)

	got := p.Reserve(k, t0, deadline.Add(-jitter), jitter)
	wantReservation(t, got, 0, true)
	if w := stateOf(t, p, k); w.remaining != 2 || !w.nextSlot.Equal(t0.Add(time.Second)) {
		t.Fatalf("the 1 s slot was committed inside the jitter margin: %+v", w)
	}

	got = p.Reserve(k, t0, t0.Add(time.Second), jitter)
	wantReservation(t, got, time.Second+jitter, true)
}

func TestReserve_JitterIsAddOnlyAndAbsentOnAZeroWait(t *testing.T) {
	const jitter = 400 * time.Millisecond
	p, k := observedPacer(200, 4, t0.Add(4*time.Second))
	latest := t0.Add(30 * time.Second)
	wantReservation(t, p.Reserve(k, t0, latest, jitter), 0, true)
	wantReservation(t, p.Reserve(k, t0, latest, jitter), time.Second+jitter, true)
}

func TestObserve_KeepsTheLowerCountWithinOneReset(t *testing.T) {
	reset := t0.Add(30 * time.Second)
	p, k := observedPacer(200, 10, reset)
	latest := t0.Add(30 * time.Second)
	p.Reserve(k, t0, latest, 0)
	p.Reserve(k, t0, latest, 0)
	slot := stateOf(t, p, k).nextSlot

	p.Observe(k, Headers{Limit: 200, Remaining: 10, Reset: reset}, t0.Add(time.Second))
	if w := stateOf(t, p, k); w.remaining != 8 || !w.nextSlot.Equal(slot) {
		t.Fatalf("a late response raised the local count or moved the slot: %+v", w)
	}

	p.Observe(k, Headers{Limit: 200, Remaining: 3, Reset: reset}, t0.Add(time.Second))
	if got := stateOf(t, p, k).remaining; got != 3 {
		t.Fatalf("local remaining = %d, want the lower observed 3", got)
	}

	p.Observe(k, Headers{Limit: 200, Remaining: 150, Reset: reset.Add(-10 * time.Second)}, t0.Add(time.Second))
	if got := stateOf(t, p, k).remaining; got != 3 {
		t.Fatalf("a response from an older window changed the count to %d", got)
	}
}

func TestObserve_AdvancedResetReplacesTheStateAndKeepsTheSlot(t *testing.T) {
	p, k := observedPacer(200, 4, t0.Add(4*time.Second))
	latest := t0.Add(30 * time.Second)
	p.Reserve(k, t0, latest, 0)
	p.Reserve(k, t0, latest, 0)
	slot := stateOf(t, p, k).nextSlot
	if !slot.Equal(t0.Add(2 * time.Second)) {
		t.Fatalf("next slot = %v, want 2 s after now", slot.Sub(t0))
	}

	next := t0.Add(30 * time.Second)
	p.Observe(k, Headers{Limit: 200, Remaining: 6, Reset: next}, t0.Add(time.Second))
	w := stateOf(t, p, k)
	if w.remaining != 6 || !w.reset.Equal(next) {
		t.Fatalf("an advanced reset did not replace the state: %+v", w)
	}
	if w.nextSlot.Before(slot) {
		t.Fatalf("next slot moved backwards: %v -> %v", slot.Sub(t0), w.nextSlot.Sub(t0))
	}
}

func TestObserve_ResetFilterAndClamp(t *testing.T) {
	p := NewPacer()
	k := p.Key(testHost, "KEY-A")
	p.Observe(k, Headers{Limit: 200, Remaining: 0, Reset: t0.Add(66 * time.Second)}, t0)
	p.Observe(k, Headers{Limit: 200, Remaining: 0, Reset: t0}, t0)
	p.Observe(k, Headers{Limit: 200, Remaining: 0, Reset: t0.Add(-time.Second)}, t0)
	if len(p.windows) != 0 {
		t.Fatalf("an unusable reset changed the state: %d windows", len(p.windows))
	}

	p.Observe(k, Headers{Limit: 200, Remaining: 0, Reset: t0.Add(62 * time.Second)}, t0)
	if got := stateOf(t, p, k).reset; !got.Equal(t0.Add(Window)) {
		t.Fatalf("stored reset = %v after now, want it clamped to one window", got.Sub(t0))
	}
	wantReservation(t, p.Reserve(k, t0, t0.Add(Window), 0), Window, true)
	wantReservation(t, p.Reserve(k, t0, t0.Add(Window-time.Nanosecond), 0), Window, false)

	p = NewPacer()
	p.Observe(k, Headers{Limit: 200, Remaining: 0, Reset: t0.Add(Window + ResetSlack)}, t0)
	if len(p.windows) != 1 {
		t.Fatalf("a reset exactly one window plus slack ahead was refused")
	}
}

func TestObserve_PrunesExpiredWindows(t *testing.T) {
	p, _ := observedPacer(200, 0, t0.Add(time.Second))
	other := p.Key("paper-api.alpaca.markets", "KEY-A")
	p.Observe(other, Headers{Limit: 200, Remaining: 150, Reset: t0.Add(40 * time.Second)}, t0.Add(5*time.Second))
	if len(p.windows) != 1 || p.windows[other] == nil {
		t.Fatalf("expired window not pruned: %d windows", len(p.windows))
	}
}

func TestRetryWait_BacksOffWithoutAReset(t *testing.T) {
	const jitter = 300 * time.Millisecond
	for attempt, want := range map[int]time.Duration{
		1: time.Second, 2: 2 * time.Second, 3: 4 * time.Second, 4: 8 * time.Second, 5: 8 * time.Second, 70: 8 * time.Second,
	} {
		if got := RetryWait(attempt, t0, time.Time{}, jitter); got != want+jitter {
			t.Errorf("RetryWait(attempt %d) = %v, want %v", attempt, got, want+jitter)
		}
	}
	if got := RetryWait(2, t0, t0.Add(-time.Second), 0); got != 2*time.Second {
		t.Errorf("a reset in the past: RetryWait = %v, want the 2 s backoff", got)
	}
}

func TestRetryWait_UsesTheResetCappedAtOneWindow(t *testing.T) {
	const jitter = 300 * time.Millisecond
	if got := RetryWait(1, t0, t0.Add(3600*time.Second), jitter); got != Window+jitter {
		t.Errorf("reset 3600 s ahead: RetryWait = %v, want %v", got, Window+jitter)
	}
	if got := RetryWait(3, t0, t0.Add(2*time.Second), jitter); got != 2*time.Second+jitter {
		t.Errorf("reset 2 s ahead: RetryWait = %v, want %v", got, 2*time.Second+jitter)
	}
}

func TestKey_SeparatesCredentialsAndHosts(t *testing.T) {
	p := NewPacer()
	a, b := p.Key(testHost, "KEY-A"), p.Key(testHost, "KEY-B")
	if a == b {
		t.Fatalf("two API keys on one host share a pacing key")
	}
	if a != p.Key(testHost, "KEY-A") {
		t.Fatalf("the same host and API key gave two pacing keys")
	}
	if a == p.Key("paper-api.alpaca.markets", "KEY-A") {
		t.Fatalf("two hosts share a pacing key")
	}

	p.Observe(a, Headers{Limit: 200, Remaining: 0, Reset: t0.Add(5 * time.Second)}, t0)
	latest := t0.Add(30 * time.Second)
	wantReservation(t, p.Reserve(b, t0, latest, 0), 0, true)
	wantReservation(t, p.Reserve(p.Key(testHost, ""), t0, latest, 0), 0, true)
	wantReservation(t, p.Reserve(a, t0, latest, 0), 5*time.Second, true)
}

func TestWarnOnce_OncePerThrottledWindow(t *testing.T) {
	p := NewPacer()
	k, other := p.Key(testHost, "KEY-A"), p.Key("paper-api.alpaca.markets", "KEY-A")
	until := t0.Add(3 * time.Second)

	if !p.WarnOnce(k, t0, until) {
		t.Fatalf("first call in a throttled window returned false")
	}
	if p.WarnOnce(k, t0.Add(time.Second), t0.Add(9*time.Second)) || p.WarnOnce(k, until, until) {
		t.Fatalf("a second call inside the window returned true")
	}
	if !p.WarnOnce(other, t0, until) {
		t.Fatalf("another key was silenced by the first key's window")
	}
	if !p.WarnOnce(k, until.Add(time.Nanosecond), until.Add(time.Minute)) {
		t.Fatalf("the first call after the window ended returned false")
	}
}
