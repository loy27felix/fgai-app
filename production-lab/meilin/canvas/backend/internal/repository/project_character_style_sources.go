package repository

type CharacterResourceIdentity struct {
	AssetID    string
	Title      string
	ResourceID string
}

func (r *Repository) ProjectCharacterResourceIdentities(projectID string) ([]CharacterResourceIdentity, error) {
	var rows []CharacterResourceIdentity
	err := r.db.Table("assets a").Select("DISTINCT a.id AS asset_id, a.title, ar.resource_id").
		Joins("JOIN project_asset_links pal ON pal.asset_id = a.id").
		Joins("JOIN asset_versions av ON av.asset_id = a.id").
		Joins("JOIN asset_representations ar ON ar.asset_version_id = av.id").
		Where("pal.project_id = ? AND a.category = ? AND (ar.media_type = ? OR ar.media_type LIKE ?) AND ar.resource_id <> ''", projectID, "character", "image", "image/%").
		Order("a.id asc, ar.resource_id asc").Scan(&rows).Error
	return rows, err
}
