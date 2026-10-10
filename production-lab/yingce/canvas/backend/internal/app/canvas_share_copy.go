package app

import (
	"errors"
	"io"
	"path/filepath"

	"yingce/backend/internal/model"
)

type shareCopyReader struct {
	body      io.Reader
	remaining int64
}

func (r *shareCopyReader) Read(buffer []byte) (int, error) {
	if int64(len(buffer)) > r.remaining+1 {
		buffer = buffer[:r.remaining+1]
	}
	n, err := r.body.Read(buffer)
	r.remaining -= int64(n)
	if r.remaining < 0 {
		return 0, errors.New("分享素材大小已变化，请重新打开分享链接")
	}
	if err == io.EOF && r.remaining > 0 {
		return n, io.ErrUnexpectedEOF
	}
	return n, err
}

func (h canvasHost) CopySharedCanvasResource(userID string, source *model.Resource) (*model.Resource, error) {
	stream, err := h.svc.openResourceRange(source.UserID, source, "")
	if err != nil {
		return nil, err
	}
	defer stream.Body.Close()
	day, err := h.svc.reserveUserUploadQuota(userID, source.Size)
	if err != nil {
		return nil, err
	}
	uploadKey := normalizedResourceUploadKey([]string{newID()})
	resource, stored, err := h.svc.storeResource(userID, source.Kind, filepath.Base(source.ObjectKey), source.MimeType, source.Size, source.Width, source.Height, source.DurationMs, &shareCopyReader{body: stream.Body, remaining: source.Size}, uploadKey, false)
	if err != nil || !stored {
		h.svc.releaseUserUploadQuota(userID, day, source.Size)
	} else {
		h.svc.commitUserUploadQuota(userID, source.Size)
	}
	if err != nil {
		if partial, lookupErr := h.svc.resourceForUploadKey(userID, uploadKey); lookupErr == nil && partial != nil {
			err = errors.Join(err, h.DiscardSharedCanvasResource(partial))
		}
	}
	return resource, err
}

func (h canvasHost) DiscardSharedCanvasResource(resource *model.Resource) error {
	// This object was created by the unfinished copy and has never been published.
	if err := h.svc.deleteStoredResourceObject(resource.UserID, resource); err != nil {
		return err
	}
	return h.svc.repo.DeleteResource(resource.UserID, resource.ID)
}

func (h canvasHost) CanvasCopyQuota(userID string, library []model.Asset, canvasBytes int64) error {
	policy, err := h.svc.RuntimePolicy()
	if err != nil {
		return err
	}
	usage, err := h.svc.repo.UserStorageUsage(userID)
	if err != nil {
		return err
	}
	var assetBytes int64
	for _, asset := range library {
		assetBytes += int64(len(asset.PayloadJSON))
	}
	if err := validateStructuredReplacementQuotaWithPolicy(usage, "asset", int(usage.AssetCount)+len(library), usage.AssetBytes+assetBytes, policy.Resource); err != nil {
		return err
	}
	usage.AssetBytes += assetBytes
	return validateStructuredStorageQuotaWithPolicy(usage, "canvas", true, canvasBytes, policy.Resource)
}
