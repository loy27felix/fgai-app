package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

type FGCompanyAssetInput struct {
	ResourceID       string `json:"resourceId"`
	Title            string `json:"title"`
	Category         string `json:"category"`
	Brand            string `json:"brand"`
	Character        string `json:"character"`
	Style            string `json:"style"`
	View             string `json:"view"`
	Note             string `json:"note"`
	Status           string `json:"status"`
	ExpectedRevision int64  `json:"expectedRevision"`
}
type FGCompanyAssetPage struct {
	Assets   []model.FGCompanyAsset      `json:"assets"`
	Total    int64                       `json:"total"`
	Page     int                         `json:"page"`
	PageSize int                         `json:"pageSize"`
	Facets   map[string]map[string]int64 `json:"facets"`
}

func fgCompanyActor(actor *model.User, write bool) error {
	if os.Getenv("CANVAS_FG_TEAM_WORKSPACE") != "true" {
		return Forbidden("公司素材库未开放")
	}
	if actor == nil || actor.ID == "" {
		return Forbidden("请先登录")
	}
	if write && actor.Role != model.UserRoleAdmin {
		return Forbidden("只有超级管理员可以管理公司素材")
	}
	return nil
}
func (s *Service) FGCompanyAssets(actor *model.User, f repository.FGCompanyAssetFilter) (FGCompanyAssetPage, error) {
	if err := fgCompanyActor(actor, false); err != nil {
		return FGCompanyAssetPage{}, err
	}
	f.Page, f.PageSize = normalizeProjectPage(f.Page, f.PageSize, 120)
	if f.Status == "" {
		f.Status = "active"
	}
	if f.Status != "active" && f.Status != "archived" {
		return FGCompanyAssetPage{}, BadAuthRequest("素材状态无效")
	}
	if f.Status == "archived" && actor.Role != model.UserRoleAdmin {
		return FGCompanyAssetPage{}, Forbidden("只有超级管理员可以管理下架素材")
	}
	rows, total, err := s.repo.FGCompanyAssets(f)
	if err != nil {
		return FGCompanyAssetPage{}, err
	}
	facets, err := s.repo.FGCompanyAssetFacets(f.Status)
	return FGCompanyAssetPage{Assets: rows, Total: total, Page: f.Page, PageSize: f.PageSize, Facets: facets}, err
}
func normalizeFGCompanyAsset(req FGCompanyAssetInput, item *model.FGCompanyAsset) error {
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" || utf8.RuneCountInString(req.Title) > 160 {
		return BadAuthRequest("请输入 160 字以内的素材名称")
	}
	switch req.Category {
	case "character", "environment", "prop", "voice", "music", "material":
	default:
		return BadAuthRequest("请选择素材分类")
	}
	for _, value := range []string{req.Brand, req.Character, req.Style, req.View} {
		if utf8.RuneCountInString(strings.TrimSpace(value)) > 80 {
			return BadAuthRequest("分类字段不能超过 80 字")
		}
	}
	if utf8.RuneCountInString(req.Note) > 4000 {
		return BadAuthRequest("素材说明不能超过 4000 字")
	}
	if req.Status == "" {
		req.Status = "active"
	}
	if req.Status != "active" && req.Status != "archived" {
		return BadAuthRequest("素材状态无效")
	}
	if (req.Category == "voice" || req.Category == "music") && item.Kind != "audio" {
		return BadAuthRequest("声线和音乐分类需要上传音频")
	}
	item.Title = req.Title
	item.Category = req.Category
	item.Brand = strings.TrimSpace(req.Brand)
	item.Character = strings.TrimSpace(req.Character)
	item.Style = strings.TrimSpace(req.Style)
	item.View = strings.TrimSpace(req.View)
	item.Note = strings.TrimSpace(req.Note)
	item.Status = req.Status
	item.UpdatedAt = time.Now().UTC()
	return nil
}
func (s *Service) PublishFGCompanyAsset(actor *model.User, req FGCompanyAssetInput) (*model.FGCompanyAsset, error) {
	if err := fgCompanyActor(actor, true); err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	resource, err := s.repo.Resource(strings.TrimSpace(req.ResourceID))
	if err != nil {
		return nil, BadAuthRequest("素材文件不存在")
	}
	// Promotion is explicit and owner-only; knowing another user's resource ID cannot publish it.
	if resource.UserID != actor.ID || resource.Status != model.ResourceStatusReady || resource.Provider != "local" {
		return nil, BadAuthRequest("请上传本人已保存到 NAS 的素材文件")
	}
	if resource.Kind != "image" && resource.Kind != "video" && resource.Kind != "audio" {
		return nil, BadAuthRequest("公司素材库支持图片、视频和音频")
	}
	if resource.Kind == "image" && (resource.Width <= 0 || resource.Height <= 0) {
		return nil, BadAuthRequest("缺少图片尺寸，请重新上传")
	}
	item := &model.FGCompanyAsset{ID: newID(), ResourceID: resource.ID, PublisherID: actor.ID, Kind: resource.Kind, Revision: 1, CreatedAt: time.Now().UTC()}
	if err = normalizeFGCompanyAsset(req, item); err != nil {
		return nil, err
	}
	if err = s.repo.CreateFGCompanyAsset(item); err != nil {
		return nil, err
	}
	return item, nil
}
func (s *Service) UpdateFGCompanyAsset(actor *model.User, id string, req FGCompanyAssetInput) (*model.FGCompanyAsset, error) {
	if err := fgCompanyActor(actor, true); err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	item, err := s.repo.FGCompanyAsset(id)
	if err != nil {
		return nil, NotFound("公司素材不存在")
	}
	if req.ExpectedRevision <= 0 {
		return nil, BadAuthRequest("缺少素材版本，请刷新后再保存")
	}
	if req.ResourceID != "" && req.ResourceID != item.ResourceID {
		return nil, BadAuthRequest("原文件不可替换，请上传新版本")
	}
	if err = normalizeFGCompanyAsset(req, item); err != nil {
		return nil, err
	}
	if err = s.repo.UpdateFGCompanyAsset(item, req.ExpectedRevision); errors.Is(err, repository.ErrFGCompanyAssetConflict) {
		return nil, creationConflict("素材已被其他管理员更新，请刷新后再试")
	}
	return item, err
}

type FGCompanyAssetPurgeResult struct {
	FileRetained  bool `json:"fileRetained"`
	CleanupQueued bool `json:"cleanupQueued"`
}

func (s *Service) PurgeFGCompanyAsset(actor *model.User, id string, expected int64) (FGCompanyAssetPurgeResult, error) {
	result := FGCompanyAssetPurgeResult{}
	if err := fgCompanyActor(actor, true); err != nil {
		return result, err
	}
	if expected <= 0 {
		return result, BadAuthRequest("缺少素材版本，请刷新后再删除")
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	err := s.repo.PurgeFGCompanyAsset(id, expected, func(tx *repository.Repository, item *model.FGCompanyAsset) ([]model.Resource, []model.ResourceDeletionJob, error) {
		resource, err := tx.Resource(item.ResourceID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil
		}
		if err != nil {
			return nil, nil, err
		}
		owners, err := tx.CompanyResourceReferenceOwners()
		if err != nil {
			return nil, nil, err
		}
		candidate := map[string]struct{}{resource.ID: {}}
		for _, owner := range owners {
			snapshot, err := tx.ResourceReferenceSnapshot(owner, "", []string{resource.ID})
			if err != nil {
				return nil, nil, err
			}
			for _, direct := range snapshot.Direct {
				if direct.ResourceID == resource.ID {
					result.FileRetained = true
					return nil, nil, nil
				}
			}
			for _, document := range snapshot.Documents {
				if documentReferencesResources(document.PrimaryJSON, candidate) || documentReferencesResources(document.SecondaryJSON, candidate) {
					result.FileRetained = true
					return nil, nil, nil
				}
			}
		}
		count, err := tx.ResourceStorageReferenceCount(resource, []string{resource.ID})
		if err != nil {
			return nil, nil, err
		}
		var jobs []model.ResourceDeletionJob
		if count == 0 {
			jobs = resourceDeletionJobs(resource.UserID, map[string]*model.Resource{resourceStorageIdentity(resource): resource})
			result.CleanupQueued = len(jobs) > 0
		} else {
			result.FileRetained = true
		}
		return []model.Resource{*resource}, jobs, nil
	})
	if errors.Is(err, repository.ErrFGCompanyAssetConflict) {
		return result, creationConflict("素材已重新上架或被更新，请刷新后再删除")
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return result, NotFound("公司素材不存在")
	}
	if err != nil {
		return result, err
	}
	if result.CleanupQueued {
		s.runWorkerTask(func() { s.drainResourceDeletionJobs(1) })
	}
	return result, nil
}
func (s *Service) UseFGCompanyAsset(actor *model.User, id string) (json.RawMessage, error) {
	if err := fgCompanyActor(actor, false); err != nil {
		return nil, err
	}
	item, err := s.repo.FGCompanyAsset(id)
	if err != nil || item.Status != "active" {
		return nil, NotFound("公司素材已下架或不存在")
	}
	digest := sha256.Sum256([]byte(actor.ID + ":" + item.ID))
	assetID := "fg-library-" + hex.EncodeToString(digest[:16])
	existing, err := s.UserAsset(actor.ID, assetID)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	resource, err := s.repo.ResourceForUser(actor.ID, item.ResourceID)
	if err != nil || resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("素材文件未就绪")
	}
	key := "resource:" + resource.ID
	data := map[string]any{"storageKey": key, "bytes": resource.Size, "mimeType": resource.MimeType}
	cover := ""
	category := item.Category
	switch item.Kind {
	case "image":
		data["dataUrl"] = key
		data["width"] = resource.Width
		data["height"] = resource.Height
		cover = key
	case "video":
		data["url"] = key
		data["width"] = resource.Width
		data["height"] = resource.Height
		data["durationMs"] = resource.DurationMs
	case "audio":
		data["url"] = key
		data["durationMs"] = resource.DurationMs
	}
	if category == "voice" || category == "music" {
		category = "material"
	}
	tags := []string{"公司素材"}
	for _, tag := range []string{item.Brand, item.Character, item.Style, item.View} {
		if tag != "" {
			tags = append(tags, tag)
		}
	}
	now := time.Now().UTC()
	raw, err := json.Marshal(map[string]any{"id": assetID, "kind": item.Kind, "title": item.Title, "category": category, "coverUrl": cover, "tags": tags, "status": "confirmed", "source": "FG 公司素材库", "note": item.Note, "data": data, "metadata": map[string]any{"companyAssetId": item.ID}, "createdAt": now, "updatedAt": now})
	if err != nil {
		return nil, err
	}
	if _, err = s.canvasDomain().UpsertUserAssetValidated(actor.ID, raw, func() error {
		current, readErr := s.repo.FGCompanyAsset(id)
		if readErr != nil || current.Status != "active" || current.Revision != item.Revision {
			return NotFound("公司素材已下架或更新，请刷新后再使用")
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s.UserAsset(actor.ID, assetID)
}
