package handler

import (
	"github.com/gin-gonic/gin"
	"meilin/backend/internal/service"
	"net/http"
)

func RegisterPersonalGPTRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/settings/personal-gpt", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		value, err := svc.PersonalGPT(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.PUT("/settings/personal-gpt", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			BaseURL string `json:"baseUrl"`
			APIKey  string `json:"apiKey"`
		}
		if err = c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.SavePersonalGPT(user.ID, req.BaseURL, req.APIKey)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.DELETE("/settings/personal-gpt", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err = svc.DeletePersonalGPT(user.ID); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"configured": false})
	})
}
