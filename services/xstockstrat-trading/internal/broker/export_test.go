package broker

import (
	"context"
	"net/http"
	"time"
)

func SetNow(c *Client, now func() time.Time) { c.now = now }

func SetSleep(c *Client, sleep func(ctx context.Context, d time.Duration) error) { c.sleep = sleep }

func SetJitter(c *Client, jitter func() time.Duration) { c.jitter = jitter }

func SetTransport(c *Client, rt http.RoundTripper) { c.httpClient.Transport = rt }
