package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
)

// A missing chapter batch may be submitted again after a lost HTTP response.
// Derive its task identity from the account and exact chapter/batch/index,
// while retaining the normal task admission, routing and billing transaction.
func chapterSubmissionTaskID(userID string, req CreateTaskRequest) string {
	metadata, ok := req.Input["metadata"].(map[string]any)
	if !ok || req.Type != "canvas_text" || req.Operation != "storyboard" || metadata["source"] != "short-drama-chapter-storyboard" {
		return ""
	}
	// A repair is a new model request, not a repeat of the original submission.
	if metadata["storyboardRepairOf"] != nil {
		return ""
	}
	batch, _ := metadata["storyboardBatchId"].(string)
	chapter, _ := metadata["chapterId"].(string)
	key, _ := metadata["storyboardSubmissionKey"].(string)
	part, err := strconv.Atoi(fmt.Sprint(metadata["batchIndex"]))
	if err != nil {
		return ""
	}
	count, err := strconv.Atoi(fmt.Sprint(metadata["batchCount"]))
	if err != nil {
		return ""
	}
	if batch == "" || len(batch) > 80 || chapter == "" || req.ProjectID == "" || part < 1 || part > count || count > 24 || key != fmt.Sprintf("%s:%d", batch, part) {
		return ""
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{"chapter-submission-v1", userID, req.ProjectID, chapter, key}, "\x00")))
	return hex.EncodeToString(sum[:16])
}
