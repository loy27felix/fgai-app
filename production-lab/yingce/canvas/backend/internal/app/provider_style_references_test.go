package app

import (
	"strings"
	"testing"
	"yingce/backend/internal/model"
)

func TestStyleReferenceImagesAreOwnedDeduplicatedAndPreserveMedia(t *testing.T) {
	service, db := newProjectSettingsTestService(t)
	resource := model.Resource{ID: "style-owned", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/webp", Width: 1536, Height: 864, Size: 3210}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	profile := styleProfileDocument{Assets: []styleProfileAsset{{ID: "ref", Kind: "reference", Title: "夜色", Status: "validated", ReferenceResourceIDs: []string{resource.ID, resource.ID}}}}
	input := canvasGenerationInput{Prompt: "英国人物", ReferenceImages: []providerMedia{{StorageKey: "resource:" + resource.ID, MimeType: "image/webp", Width: 1536, Height: 864, Bytes: 3210}}}
	if err := service.appendStyleReferenceImages("user-1", profile, &input); err != nil {
		t.Fatal(err)
	}
	if len(input.ReferenceImages) != 1 || input.ReferenceImages[0].MimeType != "image/webp" || input.ReferenceImages[0].Width != 1536 || input.ReferenceImages[0].Bytes != 3210 {
		t.Fatalf("lost or duplicated media: %#v", input.ReferenceImages)
	}
	if !strings.Contains(input.Prompt, "参考图片1（夜色）") || !strings.Contains(input.Prompt, "不继承") {
		t.Fatalf("missing scoped reference: %s", input.Prompt)
	}
	empty := canvasGenerationInput{}
	if err := service.appendStyleReferenceImages("other-user", profile, &empty); err == nil {
		t.Fatal("other user's image was accepted")
	}
	if len(empty.ReferenceImages) != 0 {
		t.Fatal("unauthorized image appended")
	}
	empty = canvasGenerationInput{}
	if err := service.appendStyleReferenceImages("user-1", profile, &empty); err != nil {
		t.Fatal(err)
	}
	if len(empty.ReferenceImages) != 1 || empty.ReferenceImages[0].MimeType != "image/webp" || empty.ReferenceImages[0].Height != 864 {
		t.Fatalf("server refs not hydrated: %#v", empty.ReferenceImages)
	}
}

func TestStyleReferenceImagesRejectPendingOrNonImage(t *testing.T) {
	service, db := newProjectSettingsTestService(t)
	for _, r := range []model.Resource{{ID: "pending-style", UserID: "user-1", Kind: "image", Status: model.ResourceStatusPending, MimeType: "image/png"}, {ID: "audio-style", UserID: "user-1", Kind: "audio", Status: model.ResourceStatusReady, MimeType: "audio/wav"}} {
		if err := db.Create(&r).Error; err != nil {
			t.Fatal(err)
		}
		p := styleProfileDocument{Assets: []styleProfileAsset{{Kind: "reference", Status: "validated", ReferenceResourceIDs: []string{r.ID}}}}
		input := canvasGenerationInput{}
		if err := service.appendStyleReferenceImages("user-1", p, &input); err == nil {
			t.Fatalf("invalid style accepted: %s", r.ID)
		}
	}
}

func TestCharacterStyleDoesNotUseAnotherCharactersPortraitUnlessExplicitlySelected(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, _ := seedWorkflowProject(t, db)
	for _, value := range []any{
		&model.Asset{ID: "evan", UserID: "user-1", Category: model.AssetCategoryCharacter, Kind: "entity", Title: "Evan", PrimaryVersionID: "evan-v"},
		&model.Asset{ID: "investigator", UserID: "user-1", Category: model.AssetCategoryCharacter, Kind: "entity", Title: "调查人员", PrimaryVersionID: "investigator-v"},
		&model.AssetVersion{ID: "evan-v", AssetID: "evan", DefinitionJSON: `{}`},
		&model.AssetVersion{ID: "investigator-v", AssetID: "investigator", DefinitionJSON: `{}`},
		&model.ProjectAssetLink{ID: "pal-evan", ProjectID: project.ID, AssetID: "evan"},
		&model.ProjectAssetLink{ID: "pal-investigator", ProjectID: project.ID, AssetID: "investigator"},
		&model.AssetRepresentation{ID: "evan-image", AssetVersionID: "evan-v", ResourceID: "evan-portrait", MediaType: "image/png", Role: "primary"},
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	makeProfile := func() styleProfileDocument {
		return styleProfileDocument{Assets: []styleProfileAsset{{Kind: "reference", ReferenceResourceIDs: []string{"evan-portrait", "palette"}}}}
	}
	profile := makeProfile()
	input := canvasGenerationInput{Mode: "image", Prompt: "为调查人员生成三视图", Metadata: map[string]any{"characterAssetId": "investigator"}, ReferenceImages: []providerMedia{{StorageKey: "resource:evan-portrait"}, {StorageKey: "resource:palette"}}}
	if err := service.isolateCharacterStyleIdentity("user-1", project.ID, &profile, &input); err != nil {
		t.Fatal(err)
	}
	if len(input.ReferenceImages) != 1 || input.ReferenceImages[0].StorageKey != "resource:palette" || len(profile.Assets[0].ReferenceResourceIDs) != 1 {
		t.Fatalf("protagonist reference leaked: %+v", input.ReferenceImages)
	}
	if !strings.Contains(input.Prompt, "唯一主体：调查人员") || input.Metadata["excludedCharacterStyleReferences"] == nil {
		t.Fatal("missing identity boundary or audit record")
	}
	profile = makeProfile()
	input.Metadata["characterIdentityReferenceIds"] = []string{"evan-portrait"}
	if err := service.isolateCharacterStyleIdentity("user-1", project.ID, &profile, &input); err != nil {
		t.Fatal(err)
	}
	if len(profile.Assets[0].ReferenceResourceIDs) != 2 {
		t.Fatal("explicit user selection was discarded")
	}
	profile = makeProfile()
	if err := service.isolateCharacterStyleIdentity("other-user", project.ID, &profile, &input); err == nil {
		t.Fatal("cross-user character accepted")
	}
}
