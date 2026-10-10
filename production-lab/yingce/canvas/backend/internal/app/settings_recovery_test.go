package app

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func TestDecryptSettingSecretRequiresRestoredKeyWithoutWriting(t *testing.T) {
	original := &Service{dataDir: t.TempDir()}
	encrypted, err := original.encryptSettingSecret("test-only-provider-key")
	if err != nil {
		t.Fatal(err)
	}
	key, err := os.ReadFile(filepath.Join(original.dataDir, ".settings-key"))
	if err != nil {
		t.Fatal(err)
	}

	for _, state := range []string{"missing-directory", "missing-key", "incomplete-key", "wrong-key", "restored-key"} {
		t.Run(state, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "data")
			if state != "missing-directory" {
				if err := os.Mkdir(dir, 0o750); err != nil {
					t.Fatal(err)
				}
			}
			path := filepath.Join(dir, ".settings-key")
			var before []byte
			if state == "incomplete-key" {
				before = []byte{1, 2, 3}
			}
			if state == "restored-key" {
				before = key
			}
			if state == "wrong-key" {
				before = bytes.Repeat([]byte{42}, 32)
			}
			if before != nil {
				if err := os.WriteFile(path, before, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			got, err := (&Service{dataDir: dir}).decryptSettingSecret(encrypted)
			if state == "restored-key" {
				if err != nil || got != "test-only-provider-key" {
					t.Fatalf("restored key did not decrypt: %v", err)
				}
			} else {
				var unavailable *kernel.AppError
				if !errors.As(err, &unavailable) || unavailable.Status != 503 {
					t.Errorf("expected a storage recovery error, got %v", err)
				}
			}
			after, readErr := os.ReadFile(path)
			if before == nil {
				if !os.IsNotExist(readErr) {
					t.Errorf("decrypt created a replacement key: %v", readErr)
				}
			} else if readErr != nil || !bytes.Equal(before, after) {
				t.Errorf("decrypt modified the existing key: %v", readErr)
			}
			if state == "missing-directory" {
				if _, err := os.Stat(dir); !os.IsNotExist(err) {
					t.Error("decrypt created the missing storage directory")
				}
			}
		})
	}
}

func TestSystemChannelRecoveryErrorIsNotReportedAsDisabled(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	svc.dataDir = t.TempDir()
	original := &Service{dataDir: t.TempDir()}
	encrypted, err := original.encryptSettingSecret("test-only-provider-key")
	if err != nil {
		t.Fatal(err)
	}
	channel := model.ModelChannel{ID: "CHANNEL_recovery", Scope: "system", Enabled: true, APIKey: encrypted}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	_, err = svc.resolveProviderConfig(providerConfig{ChannelID: channel.ID})
	var unavailable *kernel.AppError
	if !errors.As(err, &unavailable) || unavailable.Status != 503 {
		t.Fatalf("expected unavailable credentials, got %v", err)
	}
	if strings.Contains(err.Error(), "已停用") {
		t.Fatal("storage failure was reported as a disabled channel")
	}
	if _, err := os.Stat(filepath.Join(svc.dataDir, ".settings-key")); !os.IsNotExist(err) {
		t.Fatal("channel lookup created a replacement key")
	}
}

func TestSystemChannelMissingOrDisabledRemainsNotFound(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.Create(&model.ModelChannel{ID: "CHANNEL_disabled", Scope: "system", Enabled: false}).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"CHANNEL_missing", "CHANNEL_disabled"} {
		_, err := svc.SystemChannel(id)
		var missing *kernel.AppError
		if !errors.As(err, &missing) || missing.Status != 404 {
			t.Errorf("%s: expected not found, got %v", id, err)
		}
	}
}
