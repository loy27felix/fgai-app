package app

import (
	"bytes"
	"image"
	"io"
)

// Client metadata may describe the canvas display box. Decode only the image
// header and replay every byte so storage receives the original file unchanged.
func resourceImageDimensions(body io.Reader, width, height int) (io.Reader, int, int) {
	var prefix bytes.Buffer
	config, _, err := image.DecodeConfig(io.LimitReader(io.TeeReader(body, &prefix), 4<<20))
	body = io.MultiReader(bytes.NewReader(prefix.Bytes()), body)
	if err == nil && config.Width > 0 && config.Height > 0 {
		return body, config.Width, config.Height
	}
	return body, width, height
}
