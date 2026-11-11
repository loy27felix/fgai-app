package repository

import (
	"meilin/backend/internal/model"
	"time"
)

type MeilinWorkspaceItem struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Status    string    `json:"status,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type MeilinWorkspaceOverview struct {
	Projects []MeilinWorkspaceItem `json:"projects"`
	Canvases []MeilinWorkspaceItem `json:"canvases"`
	Tasks    []MeilinWorkspaceItem `json:"tasks"`
}

// The home assistant reads bounded summaries of the caller's own objects.
// Prompts, resource links, credentials and other members' objects are omitted.
func (r *Repository) MeilinWorkspaceOverview(userID string) (MeilinWorkspaceOverview, error) {
	value := MeilinWorkspaceOverview{Projects: []MeilinWorkspaceItem{}, Canvases: []MeilinWorkspaceItem{}, Tasks: []MeilinWorkspaceItem{}}
	if userID == "" {
		return value, nil
	}
	if err := r.db.Model(&model.Project{}).Select("id", "name AS title", "status", "updated_at").Where("user_id = ?", userID).Order("updated_at DESC, id DESC").Limit(20).Scan(&value.Projects).Error; err != nil {
		return value, err
	}
	if err := r.db.Model(&model.CanvasProject{}).Select("id", "title", "updated_at").Where("user_id = ?", userID).Order("updated_at DESC, id DESC").Limit(20).Scan(&value.Canvases).Error; err != nil {
		return value, err
	}
	err := r.db.Model(&model.Task{}).Select("id", "type AS title", "status", "updated_at").Where("user_id = ?", userID).Order("updated_at DESC, id DESC").Limit(20).Scan(&value.Tasks).Error
	return value, err
}
