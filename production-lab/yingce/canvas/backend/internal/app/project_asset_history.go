package app

import (
	"strings"
	"time"

	"yingce/backend/internal/model"
)

type ProjectAssetHistoryImage struct {
	VersionID  string    `json:"versionId"`
	Version    int       `json:"version"`
	ResourceID string    `json:"resourceId"`
	Role       string    `json:"role"`
	CreatedAt  time.Time `json:"createdAt"`
}

// History is available only through an asset already linked to an accessible project.
func (s *Service) ProjectAssetHistoryImages(userID, projectID, assetID string) ([]ProjectAssetHistoryImage, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return nil, err
	}
	asset, err := s.repo.AssetForUser(userID, strings.TrimSpace(assetID))
	if err != nil {
		return nil, err
	}
	linked, err := s.repo.ProjectAssetLinked(projectID, asset.ID)
	if err != nil {
		return nil, err
	}
	if !linked {
		return nil, BadAuthRequest("素材尚未加入当前项目")
	}
	versions, err := s.repo.AssetVersions(asset.ID)
	if err != nil {
		return nil, err
	}
	images := make([]ProjectAssetHistoryImage, 0)
	for _, version := range versions {
		representations, err := s.repo.AssetRepresentations(version.ID)
		if err != nil {
			return nil, err
		}
		seen := map[string]bool{}
		for _, representation := range representations {
			if representation.MediaType != "image" || representation.ResourceID == "" || seen[representation.ResourceID] {
				continue
			}
			resource, err := s.repo.ResourceForUser(userID, representation.ResourceID)
			if err != nil || resource.Status != model.ResourceStatusReady {
				continue
			}
			seen[representation.ResourceID] = true
			images = append(images, ProjectAssetHistoryImage{version.ID, version.Version, representation.ResourceID, representation.Role, version.CreatedAt})
		}
	}
	return images, nil
}
