package model

import "time"

// Company assets keep one immutable server resource; retirement never removes files already in use.
type FGCompanyAsset struct {
	ID          string    `json:"id" gorm:"primaryKey;size:64"`
	ResourceID  string    `json:"resourceId" gorm:"uniqueIndex;size:64;not null"`
	PublisherID string    `json:"-" gorm:"size:64;not null"`
	Title       string    `json:"title" gorm:"size:160;not null"`
	Kind        string    `json:"kind" gorm:"size:16;index"`
	Category    string    `json:"category" gorm:"size:32;index"`
	Brand       string    `json:"brand" gorm:"size:80;index"`
	Character   string    `json:"character" gorm:"size:80;index"`
	Style       string    `json:"style" gorm:"size:80;index"`
	View        string    `json:"view" gorm:"size:80"`
	Note        string    `json:"note" gorm:"type:text"`
	Status      string    `json:"status" gorm:"size:16;index"`
	Revision    int64     `json:"revision" gorm:"not null;default:1"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
