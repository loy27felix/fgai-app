package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestFGReferralRetiredDespiteStoredEnabledSetting(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	s, db := newReferralTestService(t)
	saveReferralTestSetting(t, db, ReferralSetting{Enabled: true, Mode: ReferralModeAll, CommissionRateBasisPoints: 1000})
	available, err := s.ReferralAvailable(&model.User{ID: "existing-promoter", Status: model.UserStatusActive, IsPromoter: true})
	if err != nil || available {
		t.Fatalf("retired referral is available: %v %v", available, err)
	}
	var stored model.SystemSetting
	if err := db.First(&stored, "key = ?", referralSettingKey).Error; err != nil || stored.ValueJSON == "" {
		t.Fatal("historical settings were removed")
	}
}
