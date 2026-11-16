package auth

import (
	"crypto/subtle"
	"encoding/hex"

	"golang.org/x/crypto/scrypt"
)

const fgScryptPrefix = "fg-scrypt$"

func verifyFGScryptPassword(password, encoded string) bool {
	if len(encoded) != 32+1+128 || encoded[32] != ':' {
		return false
	}
	salt := encoded[:32]
	if _, err := hex.DecodeString(salt); err != nil {
		return false
	}
	expected, err := hex.DecodeString(encoded[33:])
	if err != nil {
		return false
	}
	// FG 使用 hex 文本作为 salt，而非解码后的字节；参数不可由存储值控制。
	// FG uses the hex text as salt, not decoded bytes; stored values cannot set KDF parameters.
	actual, err := scrypt.Key([]byte(password), []byte(salt), 16384, 8, 1, 64)
	return err == nil && subtle.ConstantTimeCompare(actual, expected) == 1
}
