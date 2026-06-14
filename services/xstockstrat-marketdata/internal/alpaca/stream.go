package alpaca

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/types/known/timestamppb"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
)

const (
	defaultReconnectDelayMs = 2000
	defaultMaxReconnects    = 10
	// streamReadLimit lifts coder/websocket's default 32 KiB frame cap; Alpaca data
	// frames batching many symbols can exceed it.
	streamReadLimit = 4 << 20 // 4 MiB
	// streamBarTimeframe labels streamed bars. Alpaca's `bars` WebSocket channel emits
	// 1-minute bars only — it has no 15-minute granularity — so streamed bars carry the
	// canonical "1m" interval. The platform's 15m/1h/1d storage is owned by the always-on
	// REST bar ingester (StartBarIngestPoller); streamed bars are forwarded to live
	// subscribers and not persisted into the 15m ohlcv table.
	streamBarTimeframe = "1m"
)

// streamMessage is one element of an Alpaca stream frame (frames are JSON arrays of
// these). The `T` discriminator selects the message type: "b" bar, "q" quote,
// "success"/"subscription" control, "error" error.
type streamMessage struct {
	T    string `json:"T"`
	S    string `json:"S"`
	Msg  string `json:"msg"`
	Code int    `json:"code"`
	Time string `json:"t"`
	// bar fields
	O  float64 `json:"o"`
	H  float64 `json:"h"`
	L  float64 `json:"l"`
	C  float64 `json:"c"`
	V  int64   `json:"v"`
	N  int32   `json:"n"`
	VW float64 `json:"vw"`
	// quote fields
	AP float64 `json:"ap"`
	AS int32   `json:"as"`
	BP float64 `json:"bp"`
	BS int32   `json:"bs"`
}

// streamSubscriber is one StreamBars/StreamQuotes caller. Exactly one of barCh/quoteCh
// is non-nil. symbols is the set the caller asked for; the manager only forwards matching
// messages.
type streamSubscriber struct {
	ctx     context.Context
	symbols map[string]bool
	barCh   chan *marketdatav1.Bar
	quoteCh chan *marketdatav1.Quote
}

// streamManager owns a single shared Alpaca WebSocket connection (the free plan allows
// only one concurrent connection per account) and fans incoming bars/quotes out to all
// registered subscribers. The connection is established lazily on the first subscription
// and reconnects with backoff on drop.
type streamManager struct {
	cfg ClientConfig

	mu      sync.Mutex
	subs    map[int]*streamSubscriber
	nextID  int
	running bool
}

// streamMgr lazily builds the per-Client stream manager.
func (c *Client) streamMgr() *streamManager {
	c.streamOnce.Do(func() {
		c.stream = &streamManager{cfg: c.cfg, subs: make(map[int]*streamSubscriber)}
	})
	return c.stream
}

// StreamBars returns a channel of live bars for the given symbols, backed by the shared
// Alpaca WebSocket. Alpaca streams 1-minute bars; the timeframe argument is accepted for
// interface compatibility but does not change the source granularity.
func (c *Client) StreamBars(ctx context.Context, symbols []string, _ string) (<-chan *marketdatav1.Bar, error) {
	return c.streamMgr().subscribe(ctx, symbols, true), nil
}

// StreamQuotes returns a channel of live NBBO quotes for the given symbols, backed by the
// shared Alpaca WebSocket.
func (c *Client) StreamQuotes(ctx context.Context, symbols []string) (<-chan *marketdatav1.Quote, error) {
	sub := c.streamMgr().registerQuotes(ctx, symbols)
	return sub, nil
}

// subscribe registers a bar subscriber and returns its channel. Kept generic so a future
// quote variant can share the wiring; bars set wantBars=true.
func (m *streamManager) subscribe(ctx context.Context, symbols []string, _ bool) <-chan *marketdatav1.Bar {
	ch := make(chan *marketdatav1.Bar, 256)
	sub := &streamSubscriber{ctx: ctx, symbols: toSet(symbols), barCh: ch}
	m.add(ctx, sub)
	return ch
}

func (m *streamManager) registerQuotes(ctx context.Context, symbols []string) <-chan *marketdatav1.Quote {
	ch := make(chan *marketdatav1.Quote, 256)
	sub := &streamSubscriber{ctx: ctx, symbols: toSet(symbols), quoteCh: ch}
	m.add(ctx, sub)
	return ch
}

// add registers a subscriber, starts the connection loop if it is not already running, and
// schedules removal when the subscriber's context ends.
func (m *streamManager) add(ctx context.Context, sub *streamSubscriber) {
	m.mu.Lock()
	id := m.nextID
	m.nextID++
	m.subs[id] = sub
	startLoop := !m.running
	if startLoop {
		m.running = true
	}
	m.mu.Unlock()

	if startLoop {
		go m.run()
	}
	// Remove the subscriber and close its channel when its context ends.
	go func() {
		<-ctx.Done()
		m.mu.Lock()
		delete(m.subs, id)
		m.mu.Unlock()
		if sub.barCh != nil {
			close(sub.barCh)
		}
		if sub.quoteCh != nil {
			close(sub.quoteCh)
		}
	}()
}

// run maintains the WebSocket connection: dial → auth → subscribe → read, reconnecting with
// backoff until the max-reconnect budget is exhausted or all subscribers are gone.
func (m *streamManager) run() {
	delayMs := m.cfg.ReconnectDelayMs
	if delayMs <= 0 {
		delayMs = defaultReconnectDelayMs
	}
	maxReconnects := m.cfg.MaxReconnects
	if maxReconnects <= 0 {
		maxReconnects = defaultMaxReconnects
	}

	attempts := 0
	for {
		if m.subscriberCount() == 0 {
			m.mu.Lock()
			m.running = false
			m.mu.Unlock()
			return
		}
		err := m.connectAndRead()
		if err == nil {
			// Clean shutdown (no subscribers / context canceled).
			m.mu.Lock()
			m.running = false
			m.mu.Unlock()
			return
		}
		attempts++
		slog.Warn("alpaca stream dropped", "attempt", attempts, "error", err)
		if attempts >= maxReconnects {
			slog.Error("alpaca stream giving up after max reconnects", "max", maxReconnects)
			m.mu.Lock()
			m.running = false
			m.mu.Unlock()
			return
		}
		time.Sleep(time.Duration(delayMs) * time.Millisecond)
	}
}

// connectAndRead dials, authenticates, subscribes to the union of all subscriber symbols,
// and reads until error. Returns nil only on a clean stop (no subscribers).
func (m *streamManager) connectAndRead() error {
	feed := m.cfg.Feed
	if feed == "" {
		feed = "iex"
	}
	url := fmt.Sprintf("wss://stream.data.alpaca.markets/v2/%s", feed)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	conn.SetReadLimit(streamReadLimit)
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()

	// 1. Authenticate.
	authMsg := map[string]string{"action": "auth", "key": m.cfg.APIKey, "secret": m.cfg.APISecret}
	if err := writeJSON(ctx, conn, authMsg); err != nil {
		return fmt.Errorf("auth write: %w", err)
	}

	// 2. Subscribe to the union of bar and quote symbols across all subscribers.
	barSyms, quoteSyms := m.unionSymbols()
	if len(barSyms) == 0 && len(quoteSyms) == 0 {
		return nil // nothing to do
	}
	subMsg := map[string]interface{}{"action": "subscribe"}
	if len(barSyms) > 0 {
		subMsg["bars"] = barSyms
	}
	if len(quoteSyms) > 0 {
		subMsg["quotes"] = quoteSyms
	}
	if err := writeJSON(ctx, conn, subMsg); err != nil {
		return fmt.Errorf("subscribe write: %w", err)
	}
	slog.Info("alpaca stream connected", "feed", feed, "bars", len(barSyms), "quotes", len(quoteSyms))

	// 3. Read loop.
	for {
		if m.subscriberCount() == 0 {
			return nil
		}
		_, data, err := conn.Read(ctx)
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}
		var msgs []streamMessage
		if err := json.Unmarshal(data, &msgs); err != nil {
			slog.Warn("alpaca stream: bad frame", "error", err)
			continue
		}
		for i := range msgs {
			m.dispatch(&msgs[i])
		}
	}
}

// dispatch routes one decoded message to matching subscribers.
func (m *streamManager) dispatch(msg *streamMessage) {
	switch msg.T {
	case "b":
		t, _ := time.Parse(time.RFC3339, msg.Time)
		bar := &marketdatav1.Bar{
			Symbol: msg.S, Time: timestamppb.New(t),
			Open: msg.O, High: msg.H, Low: msg.L, Close: msg.C,
			Volume: msg.V, Vwap: msg.VW, TradeCount: msg.N,
			Timeframe: streamBarTimeframe, Source: "alpaca",
		}
		m.fanoutBar(bar)
	case "q":
		t, _ := time.Parse(time.RFC3339, msg.Time)
		q := &marketdatav1.Quote{
			Symbol: msg.S, Time: timestamppb.New(t),
			AskPrice: msg.AP, AskSize: msg.AS,
			BidPrice: msg.BP, BidSize: msg.BS,
			Source: "alpaca",
		}
		m.fanoutQuote(q)
	case "error":
		slog.Error("alpaca stream error message", "code", msg.Code, "msg", msg.Msg)
	case "success", "subscription":
		// control messages — nothing to forward
	}
}

func (m *streamManager) fanoutBar(bar *marketdatav1.Bar) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, sub := range m.subs {
		if sub.barCh == nil || !sub.symbols[bar.Symbol] {
			continue
		}
		select {
		case sub.barCh <- bar:
		default: // drop for a slow consumer rather than stall the read loop
		}
	}
}

func (m *streamManager) fanoutQuote(q *marketdatav1.Quote) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, sub := range m.subs {
		if sub.quoteCh == nil || !sub.symbols[q.Symbol] {
			continue
		}
		select {
		case sub.quoteCh <- q:
		default:
		}
	}
}

func (m *streamManager) subscriberCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.subs)
}

// unionSymbols returns the deduplicated bar and quote symbol sets across all subscribers.
func (m *streamManager) unionSymbols() (bars, quotes []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	barSet := map[string]bool{}
	quoteSet := map[string]bool{}
	for _, sub := range m.subs {
		for sym := range sub.symbols {
			if sub.barCh != nil {
				barSet[sym] = true
			}
			if sub.quoteCh != nil {
				quoteSet[sym] = true
			}
		}
	}
	for s := range barSet {
		bars = append(bars, s)
	}
	for s := range quoteSet {
		quotes = append(quotes, s)
	}
	return bars, quotes
}

func writeJSON(ctx context.Context, conn *websocket.Conn, v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, data)
}

func toSet(symbols []string) map[string]bool {
	set := make(map[string]bool, len(symbols))
	for _, s := range symbols {
		set[s] = true
	}
	return set
}
