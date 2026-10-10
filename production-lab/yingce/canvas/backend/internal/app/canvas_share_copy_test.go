package app

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestSharedCanvasResourceCopiesPhysicalBytesToRecipient(t *testing.T) {
	svc, db := newResourceFallbackTestService(t)
	if err := db.AutoMigrate(&model.UserDailyUploadUsage{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}); err != nil {
		t.Fatal(err)
	}
	body := []byte("independent-media")
	source, _, err := svc.storeResource("owner", "image", "image.png", "image/png", int64(len(body)), 100, 200, 0, bytes.NewReader(body), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	host := canvasHost{svc: svc}
	copy, err := host.CopySharedCanvasResource("recipient", source)
	if err != nil {
		t.Fatal(err)
	}
	if copy.ID == source.ID || copy.ObjectKey == source.ObjectKey || copy.UserID != "recipient" || copy.Status != model.ResourceStatusReady {
		t.Fatalf("not an owned physical copy: %+v", copy)
	}
	stream, err := svc.openResourceRange("recipient", copy, "")
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(stream.Body)
	_ = stream.Body.Close()
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("copied bytes %q: %v", got, err)
	}
	if err := svc.deleteStoredResourceObject("owner", source); err != nil {
		t.Fatal(err)
	}
	stream, err = svc.openResourceRange("recipient", copy, "")
	if err != nil {
		t.Fatal(err)
	}
	got, err = io.ReadAll(stream.Body)
	_ = stream.Body.Close()
	if err != nil || !bytes.Equal(got, body) {
		t.Fatal("source removal broke copied media")
	}
	if err := host.DiscardSharedCanvasResource(copy); err != nil {
		t.Fatal(err)
	}
	_, err = svc.repo.Resource(copy.ID)
	if err == nil {
		t.Fatal("discard did not remove unfinished copy")
	}
}

func TestShareCopyReaderRejectsChangedSize(t *testing.T) {
	for _, body := range []string{"ab", "abcd"} {
		_, err := io.ReadAll(&shareCopyReader{body: strings.NewReader(body), remaining: 3})
		if err == nil {
			t.Fatalf("accepted changed length %q", body)
		}
	}
	got, err := io.ReadAll(&shareCopyReader{body: strings.NewReader("abc"), remaining: 3})
	if err != nil || string(got) != "abc" {
		t.Fatalf("valid copy %q: %v", got, err)
	}
	_, err = io.ReadAll(&shareCopyReader{body: strings.NewReader("ab"), remaining: 3})
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatal("short copy lost error contract")
	}
}
