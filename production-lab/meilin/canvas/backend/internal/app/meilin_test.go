package app

import (
	"meilin/backend/internal/model"
	"testing"
)

func TestMeilinBillingGuardRequiresActorAndOwnFeature(t *testing.T) {
	member := &model.User{Role: model.UserRoleUser}
	admin := &model.User{Role: model.UserRoleAdmin}
	if meilinBillingAllowed(true, nil) || meilinBillingAllowed(false, member) {
		t.Fatal("unsigned or disabled ordinary-member access must fail")
	}
	if !meilinBillingAllowed(true, member) || !meilinBillingAllowed(false, admin) {
		t.Fatal("enabled members and admin preview must be allowed independently of short drama")
	}
}

func TestMeilinBillingNamesSeparateDramas(t *testing.T) {
	a, err := meilinBillingName("72f7e666-928a-4b00-8b01-a49fbf07683b")
	if err != nil {
		t.Fatal(err)
	}
	b, err := meilinBillingName("82f7e666-928a-4b00-8b01-a49fbf07683b")
	if err != nil || a == b {
		t.Fatal("separate dramas must not collide on the owner/name unique index")
	}
	if _, err := meilinBillingName("invalid"); err == nil {
		t.Fatal("invalid drama ID accepted")
	}
}
