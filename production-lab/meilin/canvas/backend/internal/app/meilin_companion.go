package app

import (
	"encoding/json"
	"errors"
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
	UserID     string `json:"userId"`
	Name       string `json:"name"`
	ResourceID string `json:"resourceId"`
	Height     int    `json:"height"`
	Revision   int64  `json:"revision"`
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
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	err := func() error {
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
