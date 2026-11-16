package handler

import (
	"bytes"
	"github.com/gin-gonic/gin"
	"meilin/backend/internal/service"
	"net/http"
	"strings"
	"time"
)

func registerPersonalCompanionRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/agent/companion/uploads/:kind", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "personal-companion-upload:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.AgentAvatarBundleMaxBytes+(1<<20))
		file, err := c.FormFile("file")
		if c.Request.MultipartForm != nil {
			defer c.Request.MultipartForm.RemoveAll()
		}
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.UploadPersonalCompanion(actor, file, c.Param("kind"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/agent/companion/assets/:kind/:id/*file", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		name := strings.TrimPrefix(c.Param("file"), "/")
		data, mime, err := svc.PersonalCompanionAsset(actor, c.Param("kind"), c.Param("id"), name)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Content-Security-Policy", "default-src 'none'")
		c.Header("Content-Type", mime)
		http.ServeContent(c.Writer, c.Request, name, time.Time{}, bytes.NewReader(data))
	})
}
