package app

import "testing"

func TestFGUnlimitedStorageDoesNotBecomeZeroCapacity(t *testing.T) {
	for _, purchased := range []int64{0, 20 << 30} {
		limit := effectiveStoredFileLimit(0, purchased)
		if limit != 0 {
			t.Fatalf("unlimited base with grant %d became limited to %d", purchased, limit)
		}
		if err := validateStoredFileCapacity(200<<30, 5<<30, limit); err != nil {
			t.Fatalf("unlimited NAS blocked generation: %v", err)
		}
	}
	if got := effectiveStoredFileLimit(10<<30, 20<<30); got != 30<<30 {
		t.Fatalf("finite capacity should include purchased grant: %d", got)
	}
}
