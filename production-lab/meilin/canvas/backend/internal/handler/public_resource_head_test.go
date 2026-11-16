package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"meilin/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestPublicResourceFileRegistersHeadWithSameRoute(t *testing.T) {
	router := gin.New()
	RegisterUserDataRoutes(router.Group("/api"), &service.Service{})
	for _, path := range []string{"/api/public/resources/:id/file", "/api/public/resources/:id/file/:filename"} {
		var get, head string
		for _, route := range router.Routes() {
			if route.Path == path {
				switch route.Method {
				case http.MethodGet:
					get = route.Handler
				case http.MethodHead:
					head = route.Handler
				}
			}
		}
		if get == "" || get != head {
			t.Fatalf("HEAD must share GET's signed access handler at %s", path)
		}
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/public/resources/unsafe/file", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unexpected media write route: %d", response.Code)
	}
}
