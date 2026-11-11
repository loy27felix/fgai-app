package handler

import (
	"meilin/backend/internal/service"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Meilin owns its feature gate. Its billing container must not inherit the
// short-drama /projects gate, and accepts no client-selected owner or defaults.
func RegisterMeilinRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/meilin/billing-project", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		var input struct {
			DramaID string `json:"dramaId"`
		}
		if err := c.ShouldBindJSON(&input); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		project, err := svc.CreateMeilinBillingProject(actor, input.DramaID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"project": project})
	})
}
