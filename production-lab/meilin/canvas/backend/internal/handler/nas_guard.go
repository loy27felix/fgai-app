package handler

import (
	"strings"

	"meilin/backend/internal/storage"

	"github.com/gin-gonic/gin"
)

func NASAvailabilityGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Keep login/recovery and its branding available while media storage is guarded.
		// 媒体存储保护期间保留登录、账号恢复及登录页外观读取。
		path := strings.TrimPrefix(c.FullPath(), "/api")
		if strings.HasPrefix(path, "/auth/") || path == "/public/appearance" {
			c.Next()
			return
		}
		if err := storage.CheckNASGuard(); err != nil {
			c.Header("Retry-After", "5")
			failService(c, err)
			c.Abort()
			return
		}
		c.Next()
	}
}
