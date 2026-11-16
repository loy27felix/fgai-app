package app

import (
	"encoding/json"
	"errors"
	"mime/multipart"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"gorm.io/gorm"
	"meilin/backend/internal/model"
	"meilin/backend/internal/repository"
)

// The companion document shares the versioned profile store but is never loaded
// into model context. Appearance is private account data, not an instruction.
const meilinCompanionScope = "companion"

type MeilinCompanion struct {
	UserID                 string            `json:"userId"`
	Name                   string            `json:"name"`
	ResourceID             string            `json:"resourceId"`
	Height                 int               `json:"height"`
	Revision               int64             `json:"revision"`
	AvatarType             string            `json:"avatarType,omitempty"`
	Live2DResourceID       string            `json:"live2dResourceId,omitempty"`
	Live2DEntry            string            `json:"live2dEntry,omitempty"`
	AvatarBundleResourceID string            `json:"avatarBundleResourceId,omitempty"`
	AvatarClipStates       map[string]string `json:"avatarClipStates,omitempty"`
	OrbColor               string            `json:"orbColor,omitempty"`
}

func (s *Service) MeilinCompanion(userID string) (MeilinCompanion, error) {
	value := MeilinCompanion{UserID: userID, Name: "美林", Height: 160}
	if userID == "" {
		return value, Unauthorized("请先登录")
	}
	profile, err := s.repo.AgentProfile(userID, meilinCompanionScope, "", "")
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return value, nil
	}
	if err != nil {
		return value, err
	}
	if err := json.Unmarshal([]byte(profile.Content), &value); err != nil {
		return value, err
	}
	value.Revision = profile.Revision
	value.UserID = userID
	return value, nil
}

func (s *Service) UpdateMeilinCompanion(userID string, value MeilinCompanion) (MeilinCompanion, error) {
	if userID == "" {
		return value, Unauthorized("请先登录")
	}
	if value.UserID != userID {
		return value, BadAuthRequest("登录账号已切换，请重新读取助手设置")
	}
	value.Name = strings.TrimSpace(value.Name)
	if value.Name == "" || !utf8.ValidString(value.Name) || utf8.RuneCountInString(value.Name) > 24 || strings.ContainsFunc(value.Name, unicode.IsControl) {
		return value, BadAuthRequest("助手名字须为 1–24 个字符")
	}
	if value.Height < 80 || value.Height > 280 || value.Revision < 0 {
		return value, BadAuthRequest("形象大小须为 80–280，版本号不能为负数")
	}
	switch value.AvatarType {
	case "", "site", "orb", "image", "live2d", "bundle":
	default:
		return value, BadAuthRequest("请选择可用的助手形象类型")
	}
	if value.OrbColor != "" {
		if len(value.OrbColor) != 7 || value.OrbColor[0] != '#' {
			return value, BadAuthRequest("动态球颜色须为六位十六进制颜色")
		}
		for _, r := range value.OrbColor[1:] {
			if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
				return value, BadAuthRequest("动态球颜色无效")
			}
		}
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	actor, err := s.repo.User(userID)
	if err != nil {
		return value, err
	}
	if value.Live2DResourceID != "" {
		entry, err := s.validateLive2DResource(actor, value.Live2DResourceID, "")
		if err != nil {
			return value, err
		}
		value.Live2DEntry = entry
	}
	if value.AvatarBundleResourceID != "" {
		manifest, err := s.validateAgentAvatarBundleResource(actor, value.AvatarBundleResourceID, "")
		if err != nil {
			return value, err
		}
		if len(value.AvatarClipStates) > 8 {
			return value, BadAuthRequest("动画状态最多八个")
		}
		for state, clip := range value.AvatarClipStates {
			if !strings.Contains("|idle|queued|running|waiting_approval|completed|failed|cancelled|rejected|", "|"+state+"|") || manifest.Clips[clip] == "" {
				return value, BadAuthRequest("动画状态或片段无效")
			}
		}
	}
	if value.AvatarType == "image" && value.ResourceID == "" || value.AvatarType == "live2d" && value.Live2DResourceID == "" || value.AvatarType == "bundle" && value.AvatarBundleResourceID == "" {
		return value, BadAuthRequest("请先上传对应的完整形象资源")
	}
	err = func() error {
		if value.ResourceID != "" {
			resource, err := s.repo.ResourceForUser(userID, value.ResourceID)
			if err != nil {
				return err
			}
			if resource.UserID != userID || resource.Status != "ready" || resource.Size > 10<<20 {
				return BadAuthRequest("请选择本人上传且已保存的形象图片，最大 10 MB")
			}
			switch resource.MimeType {
			case "image/png", "image/jpeg", "image/webp", "image/gif":
			default:
				return BadAuthRequest("形象支持 PNG、JPEG、WebP 或 GIF")
			}
		}
		payload, err := json.Marshal(value)
		if err != nil {
			return err
		}
		profile := &model.AgentProfile{ID: newID(), UserID: userID, Scope: meilinCompanionScope, Content: string(payload), Hash: agentProfileHash(string(payload)), Revision: 1, UpdatedAt: time.Now()}
		if err := s.repo.SaveAgentProfile(profile, value.Revision); err != nil {
			if errors.Is(err, repository.ErrTaskStateConflict) {
				return creationConflict("助手形象已在另一处更新，请刷新后重试")
			}
			return err
		}
		value.Revision = profile.Revision
		return nil
	}()
	return value, err
}

func (s *Service) UploadPersonalCompanion(actor *model.User, header *multipart.FileHeader, kind string) (any, error) {
	if actor == nil || actor.ID == "" {
		return nil, Unauthorized("请先登录")
	}
	switch kind {
	case "live2d":
		return s.uploadLive2D(actor, header)
	case "bundle":
		return s.uploadAgentAvatarBundle(actor, header)
	default:
		return nil, BadAuthRequest("请选择 Live2D 或状态动画包")
	}
}

func (s *Service) PersonalCompanionAsset(actor *model.User, kind, id, name string) ([]byte, string, error) {
	if actor == nil || actor.ID == "" {
		return nil, "", Unauthorized("请先登录")
	}
	switch kind {
	case "live2d":
		return s.live2DAsset(actor, id, name, true)
	case "bundle":
		return s.agentAvatarBundleAsset(actor, id, name, true)
	default:
		return nil, "", NotFound("形象资源不存在")
	}
}
