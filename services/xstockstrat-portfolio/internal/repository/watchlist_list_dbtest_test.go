//go:build dbtest

package repository

import (
	"context"
	"fmt"
	"slices"
	"testing"
)

func TestListByUser_PageTokenTraversal(t *testing.T) {
	pool := testPool(t)
	repo := NewWatchlistRepo(pool)
	userID := testUserID(t)
	ctx := context.Background()

	var ids []string
	for i := range 3 {
		ids = append(ids, seedNamedWatchlist(t, pool, userID, fmt.Sprintf("wl-%d", i), false))
	}
	if len(ids) != 3 {
		t.Fatalf("seeded %d watchlists, want 3", len(ids))
	}
	slices.Sort(ids)

	t.Run("AC-1_page_size_1_traversal", func(t *testing.T) {
		var got []string
		token := ""
		for range len(ids) + 2 {
			page, next, err := repo.ListByUser(ctx, userID, 1, token)
			if err != nil {
				t.Fatalf("ListByUser(token=%q): %v", token, err)
			}
			for _, wl := range page {
				got = append(got, wl.WatchlistId)
			}
			token = next
			if token == "" {
				break
			}
		}
		if token != "" {
			t.Fatalf("traversal did not end within %d pages; last token %q", len(ids)+2, token)
		}
		if !slices.Equal(got, ids) {
			t.Fatalf("traversal = %v, want %v (every list exactly once, ascending)", got, ids)
		}
	})

	t.Run("AC-2_page_size_2_token", func(t *testing.T) {
		page, next, err := repo.ListByUser(ctx, userID, 2, "")
		if err != nil {
			t.Fatalf("ListByUser: %v", err)
		}
		var got []string
		for _, wl := range page {
			got = append(got, wl.WatchlistId)
		}
		if !slices.Equal(got, ids[:2]) {
			t.Fatalf("page = %v, want %v", got, ids[:2])
		}
		if next != ids[1] {
			t.Fatalf("next_page_token = %q, want last returned id %q", next, ids[1])
		}
	})
}
