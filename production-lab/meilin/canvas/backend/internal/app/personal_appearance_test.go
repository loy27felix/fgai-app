package app

import "testing"

func TestPersonalAppearanceAccountIsolationRevisionAndValidation(t *testing.T) {
	s, _, _, _ := cloudAgentProfileFixtureDB(t)
	value, err := s.PersonalAppearance("user")
	if err != nil || value.SkinID != "site" || value.Revision != 0 {
		t.Fatalf("default: %#v %v", value, err)
	}
	value.SkinID, value.Font, value.Mode = "longying-ink", "serif", "dark"
	if _, err := s.UpdatePersonalAppearance("other", value); err == nil {
		t.Fatal("accepted cross-account write")
	}
	saved, err := s.UpdatePersonalAppearance("user", value)
	if err != nil || saved.Revision != 1 {
		t.Fatalf("save: %#v %v", saved, err)
	}
	if _, err := s.UpdatePersonalAppearance("user", value); err == nil {
		t.Fatal("accepted stale update")
	}
	read, err := s.PersonalAppearance("user")
	if err != nil || read != saved {
		t.Fatalf("device readback: %#v %v", read, err)
	}
	other, err := s.PersonalAppearance("other")
	if err != nil || other.SkinID != "site" || other.Font != "theme" {
		t.Fatal("preferences leaked across users")
	}
	profile, err := s.CloudAgentProfile("user", "")
	if err != nil || len(profile.Layers) != 0 {
		t.Fatal("appearance injected into agent context")
	}
	for _, corrupt := range []PersonalAppearance{
		{UserID: "user", SkinID: "url(https://example.com)", Font: "theme", Mode: "light"},
		{UserID: "user", SkinID: "classic", Font: "<style>", Mode: "light"},
		{UserID: "user", SkinID: "classic", Font: "system", Mode: "unknown"},
	} {
		if _, err := s.UpdatePersonalAppearance("user", corrupt); err == nil {
			t.Fatal("accepted invalid preference")
		}
	}
	if _, err := s.PersonalAppearance(""); err == nil {
		t.Fatal("accepted anonymous access")
	}
}
