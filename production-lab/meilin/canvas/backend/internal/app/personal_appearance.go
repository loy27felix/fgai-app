package app

import (
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"meilin/backend/internal/model"
	"meilin/backend/internal/repository"
)

// Private display preferences never enter an agent's instructions or site settings.
const personalAppearanceScope = "appearance"

type PersonalAppearance struct {
	UserID   string `json:"userId"`
	SkinID   string `json:"skinId"`
	Font     string `json:"font"`
	Mode     string `json:"mode"`
	Revision int64  `json:"revision"`
}

func (s *Service) PersonalAppearance(userID string) (PersonalAppearance, error) {
	value := PersonalAppearance{UserID: userID, SkinID: "site", Font: "theme", Mode: "system"}
	if userID == "" {
		return value, Unauthorized("请先登录")
	}
	profile, err := s.repo.AgentProfile(userID, personalAppearanceScope, "", "")
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return value, nil
	}
	if err != nil {
		return value, err
	}
	if err = json.Unmarshal([]byte(profile.Content), &value); err != nil {
		return value, err
	}
	value.UserID, value.Revision = userID, profile.Revision
	return value, nil
}

func (s *Service) UpdatePersonalAppearance(userID string, value PersonalAppearance) (PersonalAppearance, error) {
	if userID == "" {
		return value, Unauthorized("请先登录")
	}
	if value.UserID != userID {
		return value, BadAuthRequest("账号已切换，请重新读取个人外观")
	}
	switch value.SkinID {
	case "site", "classic", "longying-ink", "yunhe-xianguan":
	default:
		return value, BadAuthRequest("请选择可用主题")
	}
	switch value.Font {
	case "theme", "system", "sans", "serif":
	default:
		return value, BadAuthRequest("请选择可用字体")
	}
	switch value.Mode {
	case "system", "light", "dark":
	default:
		return value, BadAuthRequest("请选择浅色、深色或跟随系统")
	}
	if value.Revision < 0 {
		return value, BadAuthRequest("版本号不能为负数")
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return value, err
	}
	profile := &model.AgentProfile{ID: newID(), UserID: userID, Scope: personalAppearanceScope, Content: string(payload), Hash: agentProfileHash(string(payload)), Revision: 1, UpdatedAt: time.Now()}
	if err := s.repo.SaveAgentProfile(profile, value.Revision); err != nil {
		if errors.Is(err, repository.ErrTaskStateConflict) {
			return value, creationConflict("个人外观已在另一台设备更新，请重新读取后保存")
		}
		return value, err
	}
	value.Revision = profile.Revision
	return value, nil
}
