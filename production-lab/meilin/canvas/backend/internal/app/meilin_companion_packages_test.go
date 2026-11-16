package app

import (
	"meilin/backend/internal/model"
	"testing"
	"time"
)

func TestPersonalCompanionPackagesStayPrivateAndPreserveSite(t *testing.T) {
	s, db, _, admin := newAppearanceTestService(t)
	actor := &model.User{ID: "personal-owner", Username: "personal-owner", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(actor).Error; err != nil {
		t.Fatal(err)
	}
	other := &model.User{ID: "personal-other", Role: model.UserRoleUser, Status: model.UserStatusActive}
	before, err := s.AdminAppearance(admin)
	if err != nil {
		t.Fatal(err)
	}
	data := agentAvatarBundleTestZIP(t, `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4()})
	raw, err := s.UploadPersonalCompanion(actor, multipartFileHeader(t, "avatar.zip", "application/zip", data), "bundle")
	if err != nil {
		t.Fatal(err)
	}
	imported := raw.(*AgentAvatarBundleImport)
	value, err := s.MeilinCompanion(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	value.AvatarType = "bundle"
	value.AvatarBundleResourceID = imported.ResourceID
	value.AvatarClipStates = map[string]string{"idle": "idle"}
	if _, err = s.UpdateMeilinCompanion(actor.ID, value); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.PersonalCompanionAsset(actor, "bundle", imported.ResourceID, "idle.mp4"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.PersonalCompanionAsset(other, "bundle", imported.ResourceID, "idle.mp4"); err == nil {
		t.Fatal("other account read a private clip")
	}
	if _, _, err = s.AgentAvatarBundleAsset(nil, imported.ResourceID, "idle.mp4"); err == nil {
		t.Fatal("personal bundle became public")
	}
	after, err := s.AdminAppearance(admin)
	if err != nil {
		t.Fatal(err)
	}
	if before.Canvas.AvatarBundleResourceID != after.Canvas.AvatarBundleResourceID || before.Canvas.AvatarType != after.Canvas.AvatarType {
		t.Fatal("personal upload changed site appearance")
	}
	refs, err := s.repo.ResourceReferenceSnapshot(actor.ID, "", []string{imported.ResourceID})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, ref := range refs.Direct {
		found = found || ref.Kind == "助手形象"
	}
	if !found {
		t.Fatal("active package not protected")
	}
	value.Revision = 1
	value.AvatarClipStates = map[string]string{"idle": "not-present"}
	if _, err = s.UpdateMeilinCompanion(actor.ID, value); err == nil {
		t.Fatal("accepted absent state clip")
	}
}
