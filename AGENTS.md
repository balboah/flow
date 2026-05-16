# AGENTS.md

Operational notes for working in this repo.

## Layout

- `flow/` — Go `main` package (the server entrypoint binary).
- `html/` — static client: HTML + JS + CSS, no build step. Served by the Go
  binary at `/`; the WebSocket endpoint is `/worms`.
- `sprites/` — Photoshop source files for the worm sprite atlases. Source
  art only, not used at runtime.
- `Dockerfile` — multi-stage build producing a static binary on
  `distroless/static-debian12:nonroot`. This is what runs in production.
- `.gcloudignore` — explicit allowlist of what gets uploaded on
  `gcloud run deploy --source=.`. We override the default
  fallback-to-`.gitignore` because `.gitignore` excludes `*.png`, which
  would drop the worm sprite atlases the client needs.

## Workflow

Use the Makefile — it documents the canonical invocations.

| Target        | What                                              |
|---------------|---------------------------------------------------|
| `make test`   | Full Go test suite (no test cache).               |
| `make run`    | Local dev server on `:5000` (override `PORT=`).   |
| `make build`  | Compile the binary locally.                       |
| `make fmt`    | `go fmt ./...`                                    |
| `make vet`    | `go vet ./...`                                    |
| `make deploy` | Deploy the current working copy to Cloud Run.     |

## Production hosting

The service runs on **Google Cloud Run**. The deploy is source-based: Cloud
Build pulls the working copy (filtered by `.gcloudignore`), builds the
container per the root `Dockerfile`, pushes it to Artifact Registry, and
rolls a new revision.

The gcloud project is `snakeflow`. `make deploy` uses whatever
`gcloud config get-value project` returns, so set it once with
`gcloud config set project snakeflow` and the Makefile picks it up.
The Cloud Run URL itself is intentionally not documented here — look it
up with `gcloud run services list --region=…` if you need it.

Service name and region default to the production values in the `Makefile`
and can be overridden per-invocation (`CLOUD_RUN_SERVICE=…
CLOUD_RUN_REGION=… make deploy`) — useful for staging.

## Conventions

- Version control is **`jj`** (Jujutsu). The repo is colocated so plain
  `git` works too, but anything beyond `status`/`log`/`diff` should go
  through `jj` to avoid stranding change-ids.
- Tests live next to production code (`*_test.go` in the repo root for the
  `flow` package). The full suite must pass before deploying.
- The client is hand-written ES5-flavoured JS — no bundler, no transpile
  step, no `node_modules`. KineticJS 5.x and jQuery 3.x load from CDN with
  SRI hashes (see `html/index.html`). The Go binary just serves the
  `html/` tree as static files.
- WebSocket protocol is JSON `{Command, Payload}` packets (see
  `protocol.go`). The server is authoritative — clients render server
  state with client-side interpolation for smoothness only.

## Quick perf debug

Append `?perf=1` to the URL to enable a top-right FPS / frame-time
overlay. Useful for on-device profiling (iPhone Safari especially).
