package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestFGInternalPolicyStorageAndPayment(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	if policy := defaultRuntimePolicy(); policy.Resource.StoredFileGB != 0 || validateRuntimePolicy(policy) != nil {
		t.Fatalf("FG default policy must allow unlimited files: %#v", policy.Resource)
	}
	svc := &Service{}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	state, err := svc.pluginStateForUser(admin, PaymentPluginWeChatNative, nil)
	if err != nil || state.PlatformAvailable || state.EffectiveEnabled {
		t.Fatalf("FG payment must be unavailable: %#v, %v", state, err)
	}
	if _, err := svc.SetPluginPlatformAvailability(admin, PaymentPluginWeChatNative, true); err == nil || !strings.Contains(err.Error(), "不启用支付") {
		t.Fatalf("FG admin must not enable payments: %v", err)
	}
	state, err = svc.pluginStateForUser(admin, PluginPromptOptimizer, nil)
	if err != nil || !state.PlatformAvailable || !state.CanToggle {
		t.Fatalf("production plugin was disabled: %#v, %v", state, err)
	}
}
