package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestReserveUserUploadQuotaRejectsSingleFileAtLimit(t *testing.T) {
	svc := newResourceTestService(t)
	_, err := svc.reserveUserUploadQuota("user-1", megabytes(defaultRuntimePolicy().Resource.ResourceUploadMB))
	if err == nil || !strings.Contains(err.Error(), "小于 50MB") {
		t.Fatalf("reserveUserUploadQuota() error = %v", err)
	}
}

func TestReserveUserUploadQuotaRejectsDailyTotalAtLimit(t *testing.T) {
	svc := newResourceTestService(t)
	daily := megabytes(defaultRuntimePolicy().Resource.DailyUploadMB)
	chunk := int64(49 << 20)
	for used := int64(0); used+chunk <= daily; used += chunk {
		if _, err := svc.reserveUserUploadQuota("user-1", chunk); err != nil {
			t.Fatal(err)
		}
	}
	// 单文件限(50MB)未命中、今日额度已满 → 拒绝并提示每日上限。
	if _, err := svc.reserveUserUploadQuota("user-1", chunk); err == nil || !strings.Contains(err.Error(), "小于 2GB") {
		t.Fatalf("reserveUserUploadQuota() error = %v", err)
	}
}

func TestReleaseUserUploadQuotaRestoresCapacity(t *testing.T) {
	svc := newResourceTestService(t)
	day, err := svc.reserveUserUploadQuota("user-1", 49<<20)
	if err != nil {
		t.Fatal(err)
	}
	svc.releaseUserUploadQuota("user-1", day, 49<<20)
	if _, err := svc.reserveUserUploadQuota("user-1", 49<<20); err != nil {
		t.Fatal(err)
	}
}

func TestCommitUserUploadQuotaKeepsDailyUsageWithoutPendingStorage(t *testing.T) {
	svc := newResourceTestService(t)
	day, err := svc.reserveUserUploadQuota("user-1", 49<<20)
	if err != nil {
		t.Fatal(err)
	}
	svc.commitUserUploadQuota("user-1", 49<<20)
	if svc.pendingStorage["user-1"] != 0 {
		t.Fatalf("pending storage = %d", svc.pendingStorage["user-1"])
	}
	usage, err := svc.repo.DailyUploadBytes("user-1", day)
	if err != nil {
		t.Fatal(err)
	}
	if usage != 49<<20 {
		t.Fatalf("daily usage = %d", usage)
	}
}

func TestReserveUserUploadQuotaRejectsTotalStoredFilesAtLimit(t *testing.T) {
	svc := newResourceTestService(t)
	if err := svc.repo.Create(&model.Resource{ID: "resource-1", UserID: "user-1", Status: model.ResourceStatusReady, Size: gigabytes(defaultRuntimePolicy().Resource.StoredFileGB) - 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.reserveUserUploadQuota("user-1", 1); err == nil || !strings.Contains(err.Error(), "20GB 上限") {
		t.Fatalf("stored-file limit error = %v", err)
	}
}

func TestFGUnlimitedStorageKeepsUsageAndUploadSafeguards(t *testing.T) {
	svc := newResourceTestService(t)
	policy := defaultRuntimePolicy()
	policy.Resource.StoredFileGB = 0
	policy.Resource.DailyUploadMB = 100
	encoded, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: runtimePolicySettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.Resource{ID: "large-original", UserID: "user-1", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "large-original.mp4", Size: 25 << 30}); err != nil {
		t.Fatal(err)
	}
	usage, err := svc.AccountFileStorageUsage("user-1")
	if err != nil || usage.UsedBytes != 25<<30 || usage.TotalBytes != 0 {
		t.Fatalf("unlimited usage = %#v, error = %v", usage, err)
	}
	for _, reserve := range []func(string, int64) (string, error){svc.reserveUserUploadQuota, svc.reserveChunkedUploadQuota, svc.reserveGeneratedResourceQuota} {
		day, err := reserve("user-1", 10<<20)
		if err != nil {
			t.Fatalf("upload above former 20GB limit rejected: %v", err)
		}
		svc.releaseUserUploadQuota("user-1", day, 10<<20)
	}
	if _, err := svc.reserveUserUploadQuota("user-1", 50<<20); err == nil {
		t.Fatal("single-file limit was lost")
	}
	for range 2 {
		if _, err := svc.reserveChunkedUploadQuota("user-1", 40<<20); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.reserveChunkedUploadQuota("user-1", 30<<20); err == nil || !strings.Contains(err.Error(), "每日") && !strings.Contains(err.Error(), "自然日") {
		t.Fatalf("daily-upload limit was lost: %v", err)
	}
}

func TestAccountFileStorageUsageUsesStoredFilePolicy(t *testing.T) {
	svc := newResourceTestService(t)
	if err := svc.repo.Create(&model.Resource{ID: "resource-1", UserID: "user-1", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "ready.png", Size: 3 << 20}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.Resource{ID: "resource-duplicate", UserID: "user-1", Status: model.ResourceStatusReady, Provider: "", ObjectKey: "ready.png", Size: 3 << 20}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.Resource{ID: "resource-failed", UserID: "user-1", Status: model.ResourceStatusFailed, Provider: "local", ObjectKey: "failed.png", Size: 7 << 20}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.Resource{ID: "resource-pending", UserID: "user-1", Status: model.ResourceStatusPending, Provider: "local", ObjectKey: "pending.png", Size: 11 << 20}); err != nil {
		t.Fatal(err)
	}
	usage, err := svc.AccountFileStorageUsage("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if usage.UsedBytes != 3<<20 || usage.TotalBytes != gigabytes(defaultRuntimePolicy().Resource.StoredFileGB) {
		t.Fatalf("AccountFileStorageUsage() = %#v", usage)
	}
}
