package app

import (
	"net/http"
	"strings"
)

func applyFGSpeechReservation(req *http.Request, id string) {
	req.Header.Del("X-FG-Budget-Reservation")
	if id != "" && req.URL.Scheme == "http" && req.URL.Host == "gateway:3010" && strings.HasPrefix(req.URL.Path, "/internal/fg/speech/") {
		req.Header.Set("X-FG-Budget-Reservation", id)
	}
}
