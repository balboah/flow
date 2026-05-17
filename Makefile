# Flow — see AGENTS.md for the dev/deploy workflow.

# Deploy targets. Override per-environment via env or `make VAR=value`.
CLOUD_RUN_SERVICE ?= flow
CLOUD_RUN_REGION  ?= europe-north1

# PORT defaults to a stable per-CWD value in 5000..5999 so concurrent jj
# workspaces don't collide on the same dev port. Override with `PORT=<n>`.
# Target-scoped + lazy so the shasum only runs for `run`/`port`.
DERIVE_PORT = $(shell printf '%d' $$((5000 + 0x$$(printf '%s' "$(CURDIR)" | shasum | cut -c1-4) % 1000)))
run port: PORT := $(if $(strip $(PORT)),$(PORT),$(DERIVE_PORT))

.PHONY: test run build deploy fmt vet port

# Full Go test suite. -count=1 skips the test cache so failures actually surface.
test:
	go test -count=1 ./...

# Local dev server. Serves the static html/ assets and the /worms WebSocket.
run:
	PORT=$(PORT) go run ./flow

# Print the dev port that `make run` would use for this checkout.
port:
	@echo $(PORT)

# Compile the server binary locally. The production image is built fresh by
# Cloud Build at deploy time, so this is for benchmarking / smoke-tests.
build:
	go build -o ./flow/flow ./flow

# Deploy the current working copy to Cloud Run. The container is built from
# the Dockerfile via Cloud Build. The active gcloud project is used — set
# it once with `gcloud config set project <id>`.
deploy:
	gcloud run deploy $(CLOUD_RUN_SERVICE) \
		--source=. \
		--region=$(CLOUD_RUN_REGION) \
		--quiet

fmt:
	go fmt ./...

vet:
	go vet ./...
