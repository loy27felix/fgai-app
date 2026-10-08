package handler

import (
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"
	"net/http"
	"strconv"
)

func fgCompanyPage(c *gin.Context, key string, fallback int) int {
	value, err := strconv.Atoi(c.Query(key))
	if err != nil {
		return fallback
	}
	return value
}

func registerFGCompanyAssetRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/fg-company-assets/:id/purge", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		var req struct {
			ExpectedRevision int64 `json:"expectedRevision"`
		}
		if err = c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("素材版本无效"))
			return
		}
		result, err := svc.PurgeFGCompanyAsset(actor, c.Param("id"), req.ExpectedRevision)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/fg-company-assets", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.FGCompanyAssets(actor, repository.FGCompanyAssetFilter{Query: c.Query("query"), Kind: c.Query("kind"), Category: c.Query("category"), Brand: c.Query("brand"), Character: c.Query("character"), Style: c.Query("style"), Status: c.Query("status"), Page: fgCompanyPage(c, "page", 1), PageSize: fgCompanyPage(c, "pageSize", 40)})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/fg-company-assets", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req service.FGCompanyAssetInput
		if err = c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("素材资料无效"))
			return
		}
		item, err := svc.PublishFGCompanyAsset(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": item})
	})
	r.PATCH("/fg-company-assets/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req service.FGCompanyAssetInput
		if err = c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("素材资料无效"))
			return
		}
		item, err := svc.UpdateFGCompanyAsset(actor, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": item})
	})
	r.POST("/fg-company-assets/:id/use", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		item, err := svc.UseFGCompanyAsset(actor, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": item})
	})
}
