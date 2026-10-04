package app

import (
	"bytes"
	"encoding/hex"
	"testing"
)

func TestRemoteResourceMIMETypeUsesMediaSignature(t *testing.T) {
	mp4, err := hex.DecodeString("000000206674797069736f6d0000020069736f6d69736f32617663316d703431")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, header, want string
		data               []byte
	}{
		{"PNG declared as text", "text/plain; charset=utf-8", "image/png", []byte("\x89PNG\r\n\x1a\n")},
		{"MP4 declared as text", "text/plain", "video/mp4", mp4},
		{"unknown binary", "application/octet-stream", "application/octet-stream", []byte{0, 1, 2}},
		{"document header", "application/pdf", "application/pdf", []byte("%PDF-1.7\n")},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := remoteResourceMIMEType(test.header, test.data); got != test.want {
				t.Fatalf("MIME = %q, want %q", got, test.want)
			}
		})
	}
}

func TestImportResourceURLRepairsReadyMIMEWithoutDownloadingAgain(t *testing.T) {
	svc := newResourceTestService(t)
	data := []byte("\x89PNG\r\n\x1a\n")
	key := "canvas-import:existing"
	resource, _, err := svc.storeResource("user-1", "image", "libtv.png", "text/plain", int64(len(data)), 1, 1, 0, bytes.NewReader(data), normalizedResourceUploadKey([]string{key}), false)
	if err != nil {
		t.Fatal(err)
	}
	// This URL cannot be downloaded. The durable idempotent object is repaired.
	repaired, err := svc.ImportResourceURL("user-1", "https://invalid.example/unreachable.png", "image", 1, 1, 0, key)
	if err != nil {
		t.Fatal(err)
	}
	if repaired.ID != resource.ID || repaired.ObjectKey != resource.ObjectKey || repaired.MimeType != "image/png" {
		t.Fatalf("unexpected repaired resource: %#v", repaired)
	}
	stored, err := svc.repo.ResourceForUser("user-1", resource.ID)
	if err != nil || stored.MimeType != "image/png" {
		t.Fatalf("durable MIME repair failed: %#v, %v", stored, err)
	}
}
