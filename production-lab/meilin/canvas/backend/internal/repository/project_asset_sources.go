package repository

type ProjectAssetSource struct {
	AssetID   string
	UnitID    string
	UnitTitle string
	ShotID    string
}

// One bounded batch lookup for the page; no task payload scan or schema change.
func (r *Repository) ProjectAssetSources(projectID string, assetIDs []string) ([]ProjectAssetSource, error) {
	if len(assetIDs) == 0 {
		return nil, nil
	}
	var rows []ProjectAssetSource
	err := r.db.Table("asset_versions av").Select("av.asset_id, ptl.unit_id, pu.title AS unit_title, ptl.shot_id").
		Joins("JOIN asset_representations ar ON ar.asset_version_id = av.id").
		Joins("JOIN production_task_links ptl ON ptl.task_id = ar.task_id").
		Joins("JOIN project_units pu ON pu.id = ptl.unit_id AND pu.project_id = ptl.project_id").
		Where("ptl.project_id = ? AND av.asset_id IN ?", projectID, assetIDs).
		Order("ptl.created_at asc, ptl.id asc").Scan(&rows).Error
	return rows, err
}
