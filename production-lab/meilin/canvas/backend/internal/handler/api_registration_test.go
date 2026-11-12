package handler

import (
	"github.com/gin-gonic/gin"
	"testing"
)

// Exercise the production composition root, not just each route module alone.
func TestCanvasAPIRouteRegistration(t *testing.T) {
	engine := gin.New()
	RegisterCanvasAPI(engine.Group("/api"), nil)
	found := map[string]bool{}
	for _, route := range engine.Routes() {
		found[route.Method+" "+route.Path] = true
	}
	for _, path := range []string{"GET /api/agent/mcp/catalog", "GET /api/admin/mcp/catalog", "GET /api/admin/integrations/feishu/preview", "GET /api/agent/companion", "POST /api/agent/companion/uploads/:kind"} {
		if !found[path] {
			t.Fatalf("missing route %s", path)
		}
	}
}
