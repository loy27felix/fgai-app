package app

import (
	"bytes"
	"image"
	"image/png"
	"testing"

	"meilin/backend/internal/model"
)

func TestFGPoseLibraryCopiesReadyImagesToPersonalResources(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	admin := model.User{ID: "pose-admin", Username: "pose-admin", Role: model.UserRoleAdmin}
	member := model.User{ID: "pose-member", Username: "pose-member"}
	if err := db.Create(&[]model.User{admin, member}).Error; err != nil {
		t.Fatal(err)
	}
	var content bytes.Buffer
	if err := png.Encode(&content, image.NewRGBA(image.Rect(0, 0, 32, 48))); err != nil {
		t.Fatal(err)
	}
	input := PoseLibraryCreateItemRequest{Name: "站姿", Angle: "正面", Data: content.Bytes()}
	if _, err := svc.CreatePoseLibraryItem(&member, input); err == nil {
		t.Fatal("普通用户可以修改站点姿势库")
	}
	item, err := svc.CreatePoseLibraryItem(&admin, input)
	if err != nil {
		t.Fatal(err)
	}
	page, err := svc.PoseLibraryCatalog(&member, PoseLibraryCatalogQuery{Keyword: input.Name})
	if err != nil || page.Total != 1 {
		t.Fatalf("查找姿势失败: %+v, %v", page, err)
	}
	if _, err := svc.OpenPoseLibraryFile(nil, item.ID, PoseLibraryFileImage); err == nil {
		t.Fatal("未登录可以读取姿势原图")
	}
	file, err := svc.OpenPoseLibraryFile(&member, item.ID, PoseLibraryFileThumb)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.File.Close(); err != nil {
		t.Fatal(err)
	}
	ids := []string{item.ID}
	copied, err := svc.UsePoseLibraryItems(&member, ids)
	if err != nil || len(copied) != 1 {
		t.Fatalf("选用姿势失败: %+v, %v", copied, err)
	}
	resource := copied[0].Resource
	if resource.UserID != member.ID || resource.Status != model.ResourceStatusReady || resource.Width != 32 || resource.Height != 48 {
		t.Fatalf("姿势资源状态错误: %+v", resource)
	}
	again, err := svc.UsePoseLibraryItems(&member, ids)
	if err != nil || len(again) != 1 || again[0].Resource.ID != resource.ID {
		t.Fatalf("重复选用未复用原资源: %+v, %v", again, err)
	}
}
