package canvas

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// Copying transfers the published snapshot, never the source user's chat,
// task credentials, project association or ordinary private access rights.
type shareCopyHost interface {
	CopySharedCanvasResource(userID string, source *model.Resource) (*model.Resource, error)
	DiscardSharedCanvasResource(resource *model.Resource) error
	CanvasCopyQuota(userID string, library []model.Asset, canvasBytes int64) error
}

func (s *Service) CopySharedCanvas(userID, token string) (result json.RawMessage, resultErr error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录，再复制到自己的画布")
	}
	share, original, err := s.sharedCanvasProject(token)
	if err != nil {
		return nil, err
	}
	document, allowed, err := publicCanvasProject(original, token)
	if err != nil {
		return nil, err
	}
	host, ok := s.host.(shareCopyHost)
	if !ok {
		return nil, errors.New("画布复制服务未配置")
	}
	ids := make([]string, 0, len(allowed))
	for id := range allowed {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	sources := make([]*model.Resource, 0, len(ids))
	// Validate the complete media manifest before the first storage write.
	for _, id := range ids {
		resource, err := s.repo.ResourceForUser(share.UserID, id)
		if err != nil {
			return nil, fmt.Errorf("分享画布的素材不可用，未创建副本：%w", err)
		}
		if resource.Status != model.ResourceStatusReady {
			return nil, kernel.BadAuthRequest("分享画布的素材尚未就绪，未创建副本")
		}
		sources = append(sources, resource)
	}
	copied := make([]*model.Resource, 0, len(sources))
	committed := false
	defer func() {
		if committed {
			return
		}
		for _, resource := range copied {
			if cleanupErr := host.DiscardSharedCanvasResource(resource); cleanupErr != nil {
				resultErr = errors.Join(resultErr, fmt.Errorf("清理未完成副本的素材失败：%w", cleanupErr))
			}
		}
	}()
	resources := map[string]*model.Resource{}
	assetIDs := map[string]string{}
	canvasID := kernel.NewID()
	library := make([]model.Asset, 0, len(sources))
	for _, source := range sources {
		resource, err := host.CopySharedCanvasResource(userID, source)
		if err != nil {
			return nil, fmt.Errorf("复制素材失败，未创建画布副本：%w", err)
		}
		copied = append(copied, resource)
		assetTitle := "分享画布素材"
		if nodes, ok := document["nodes"].([]any); ok {
			for _, value := range nodes {
				node, _ := value.(map[string]any)
				metadata, _ := node["metadata"].(map[string]any)
				if metadata["content"] == sharedCanvasResourceURL(token, source.ID) {
					assetTitle = kernel.DefaultString(kernel.StringValue(node["title"]), assetTitle)
					break
				}
			}
		}
		asset, err := copiedCanvasAsset(userID, resource, canvasID, assetTitle)
		if err != nil {
			return nil, err
		}
		resources[source.ID], assetIDs[source.ID] = resource, asset.ID
		library = append(library, asset)
	}
	now := time.Now().UTC()
	document["id"], document["revision"], document["projectId"] = canvasID, 0, ""
	document["title"] = kernel.DefaultString(kernel.StringValue(document["title"]), "共享画布") + " · 副本"
	document["createdAt"], document["updatedAt"] = now, now
	nodes, _ := document["nodes"].([]any)
	for _, value := range nodes {
		node, _ := value.(map[string]any)
		metadata, _ := node["metadata"].(map[string]any)
		delete(metadata, "status")
		for sourceID, resource := range resources {
			if metadata["content"] != sharedCanvasResourceURL(token, sourceID) {
				continue
			}
			metadata["content"] = "/api/resources/" + resource.ID + "/file"
			metadata["storageKey"], metadata["assetId"] = "resource:"+resource.ID, assetIDs[sourceID]
			metadata["status"] = "success"
			break
		}
	}
	raw, err := json.Marshal(document)
	if err != nil {
		return nil, err
	}
	project, err := canvasProjectFromJSON(userID, raw)
	if err != nil {
		return nil, err
	}
	if err := validateCopiedCanvasResources(&project, library); err != nil {
		return nil, err
	}
	err = s.host.WithStorageLock(func() error {
		if err := host.CanvasCopyQuota(userID, library, int64(len(raw))); err != nil {
			return err
		}
		return s.repo.CreateCanvasCopy(share.ID, canvasShareTokenHash(token), &project, library)
	})
	if err != nil {
		return nil, err
	}
	committed = true
	s.host.RecordActivity(userID, "canvas", 1)
	return canvasProjectPayload(project)
}

func copiedCanvasAsset(userID string, resource *model.Resource, canvasID, title string) (model.Asset, error) {
	url := "/api/resources/" + resource.ID + "/file"
	data := map[string]any{"storageKey": "resource:" + resource.ID, "bytes": resource.Size, "mimeType": resource.MimeType, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs}
	if resource.Kind == "image" {
		data["dataUrl"] = url
	} else {
		data["url"] = url
	}
	raw, err := json.Marshal(map[string]any{"id": kernel.NewID(), "kind": resource.Kind, "title": title, "coverUrl": "", "tags": []string{}, "data": data, "metadata": map[string]any{"canvasId": canvasID, "source": "canvas-upload"}})
	if err != nil {
		return model.Asset{}, err
	}
	return AssetFromJSON(userID, raw)
}

// Reject nested unpublished resource references rather than granting access.
func validateCopiedCanvasResources(project *model.CanvasProject, library []model.Asset) error {
	references, err := assets.CollectDocumentResourceReferences(project.PayloadJSON)
	if err != nil {
		return err
	}
	allowed := map[string]struct{}{}
	for _, asset := range library {
		if asset.UserID != project.UserID {
			return kernel.BadAuthRequest("副本素材归属不一致")
		}
		if err := assets.CollectOwnedDocumentReferences(asset.PayloadJSON, allowed); err != nil {
			return err
		}
	}
	for _, reference := range references {
		if _, ok := allowed[reference.ResourceID]; !ok {
			return kernel.BadAuthRequest("分享内容包含未公开的素材引用，未创建副本")
		}
	}
	return nil
}
