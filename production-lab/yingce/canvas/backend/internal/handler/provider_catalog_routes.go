package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerProviderCatalogRoutes(r *gin.RouterGroup, svc *service.Service) {
	read := func(refresh bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			view, err := svc.AdminProviderCatalog(c.Request.Context(), user, refresh)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, view)
		}
	}
	r.GET("/admin/provider-catalog", read(false))
	r.POST("/admin/provider-catalog/refresh", read(true))
	r.POST("/admin/provider-catalog/:id/verify", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.ProviderCatalogVerifyRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.VerifyProviderCatalogKey(c.Request.Context(), user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/provider-catalog/:id/install", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.ProviderCatalogInstallRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		channel, err := svc.InstallProviderCatalog(c.Request.Context(), user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channel": channel})
	})
}
