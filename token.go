package flow

import (
	"crypto/rand"
	"encoding/hex"
)

// newToken returns a random URL-safe session token. Used when the client did
// not supply one (first visit) so subsequent reconnects can identify themselves.
func newToken() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand should never fail; fall back to a static-but-warned token
		// so we don't panic the server for a single bad call.
		return "anon-" + hex.EncodeToString(b[:8])
	}
	return hex.EncodeToString(b[:])
}
