package app

import (
	"net/http"
	"testing"
)

func TestFGSpeechReservationOnlyReachesCompanyAdapter(t *testing.T) {
	for _, item := range []struct {
		url  string
		want string
	}{
		{"http://gateway:3010/internal/fg/speech/v1/audio/speech", "reservation"},
		{"https://openspeech.bytedance.com/api/v3/tts/create", ""},
		{"http://gateway:3010/internal/creator/id/v1/audio/speech", ""},
		{"http://gateway.evil:3010/internal/fg/speech/v1/audio/speech", ""},
		{"http://gateway:8080/internal/fg/speech/v1/audio/speech", ""},
	} {
		t.Run(item.url, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodPost, item.url, nil)
			req.Header.Set("X-FG-Budget-Reservation", "forged")
			applyFGSpeechReservation(req, "reservation")
			if got := req.Header.Get("X-FG-Budget-Reservation"); got != item.want {
				t.Fatalf("reservation header = %q, want %q", got, item.want)
			}
		})
	}
}
