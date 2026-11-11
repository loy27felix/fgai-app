package app

import (
	"bytes"
	"image"
	"image/png"
	"io"
	"testing"
)

func TestResourceImageDimensionsIgnoreCanvasDisplaySizeAndReplayOriginalBytes(t *testing.T) {
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 941, 1672))); err != nil {
		t.Fatal(err)
	}
	reader, width, height := resourceImageDimensions(bytes.NewBuffer(data.Bytes()), 113, 200)
	if width != 941 || height != 1672 {
		t.Fatalf("display dimensions persisted: %dx%d", width, height)
	}
	stored, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(stored, data.Bytes()) {
		t.Fatal("header detection changed the image bytes", err)
	}
}

func TestResourceImageDimensionsUnknownCodecReplaysWithoutTruncation(t *testing.T) {
	data := bytes.Repeat([]byte("unknown-codec"), 400000)
	reader, width, height := resourceImageDimensions(bytes.NewBuffer(data), 640, 480)
	stored, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(stored, data) || width != 640 || height != 480 {
		t.Fatal("unsupported codec changed content or metadata", err)
	}
}
