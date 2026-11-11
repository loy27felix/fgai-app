package app

import (
	"meilin/backend/internal/model"
	"regexp"
	"strings"
)

var meilinDramaID = regexp.MustCompile(`^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$`)

func meilinBillingName(dramaID string) (string, error) {
	if !meilinDramaID.MatchString(dramaID) {
		return "", BadAuthRequest("美林剧目标识无效")
	}
	return "美林 · 超级导演 · " + strings.ToLower(dramaID), nil
}

func meilinBillingAllowed(enabled bool, actor *model.User) bool {
	return actor != nil && (enabled || actor.Role == model.UserRoleAdmin)
}

// CreateMeilinBillingProject uses Meilin's gate independently of short drama.
// Ownership and defaults are server-owned rather than client-selected.
func (s *Service) CreateMeilinBillingProject(actor *model.User, dramaID string) (model.Project, error) {
	flags, err := s.FeatureAvailability()
	if err != nil {
		return model.Project{}, err
	}
	if !meilinBillingAllowed(flags.MeilinEnabled, actor) {
		return model.Project{}, Forbidden("美林 · 超级导演暂未开放")
	}
	name, err := meilinBillingName(dramaID)
	if err != nil {
		return model.Project{}, err
	}
	return s.CreateProject(actor.ID, CreateProjectRequest{
		Name: name, Type: "creator", AspectRatio: "9:16", SourceType: "text",
		Description: "美林独立剧目；费用按剧、集、段与资产归属。",
	})
}
