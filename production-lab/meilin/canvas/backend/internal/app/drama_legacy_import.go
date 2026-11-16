package app

import (
	"encoding/json"
	"meilin/backend/internal/production"
	"strings"
)

func (s *Service) ImportLegacyDrama(userID, projectID string) (map[string]any, error) {
	if err := s.RequireFeature(FeatureShortDrama); err != nil {
		return nil, err
	}
	project, err := s.activeProjectForUser(userID, strings.TrimSpace(projectID))
	if err != nil {
		return nil, err
	}
	settings := (DramaSettings{Settings: production.Settings{AspectRatio: project.AspectRatio, Language: "沿用原文对白，不翻译、不改写"}, MediaMode: DramaMediaManual,
		ReviewMode: "every", EpisodeMode: DramaEpisodeModeChapter, ChaptersPerEpisode: 1, VideoContinuity: DramaContinuityParallel}).normalized()
	encoded, err := json.Marshal(settings)
	if err != nil {
		return nil, err
	}
	imported, err := s.repo.ImportLegacyDrama(project.ID, string(encoded))
	if err != nil {
		return nil, err
	}
	summary, err := s.DramaSummary(userID, project.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"imported": imported, "summary": summary}, nil
}
