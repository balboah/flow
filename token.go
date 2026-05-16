package flow

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

// aiTokenPrefix is reserved for server-issued AI bot identities. Tokens
// starting with this prefix are never accepted from the network — only the
// playfield itself may register them. AI display names use the same string
// for convenience; a client claiming such a name as a token is rejected and
// assigned a fresh random one (see extractHello in server.go).
const aiTokenPrefix = "Bot-"

// newToken returns a random URL-safe session token (128 bits, hex-encoded).
// Returns "" on entropy failure so the caller can refuse the connection
// rather than fall back to a predictable identifier.
func newToken() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return ""
	}
	return hex.EncodeToString(b[:])
}

// isAIToken reports whether t is in the server-only AI namespace.
func isAIToken(t string) bool {
	return strings.HasPrefix(t, aiTokenPrefix)
}
