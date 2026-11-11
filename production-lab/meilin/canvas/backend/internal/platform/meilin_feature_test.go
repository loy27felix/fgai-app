package platform

import (
	"encoding/json"
	"testing"
)

func TestMeilinFeatureDefaultsClosedAndPersistsInSettingsJSON(t *testing.T) {
	value := DefaultFeatureAvailability()
	if value.MeilinEnabled {
		t.Fatal("Meilin must default to closed")
	}
	if err := json.Unmarshal([]byte(`{"meilinEnabled":true}`), &value); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var restored FeatureAvailability
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if !restored.MeilinEnabled || !restored.ShortDramaEnabled {
		t.Fatalf("feature settings lost independent switches: %#v", restored)
	}
}
