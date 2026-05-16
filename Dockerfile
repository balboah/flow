# Build stage: compile a static binary so we can run on distroless.
FROM golang:1.25-alpine AS builder

WORKDIR /src

# Cache the module download separately from the source so iterative builds
# don't re-pull dependencies on every code change.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 + -trimpath produces a small, reproducible, statically-linked
# binary that the distroless static image can execute directly.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/flow-server ./flow

# Runtime: distroless static-debian is ~2MB, has nothing but the binary and
# its CAs. Smallest credible attack surface.
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --from=builder /out/flow-server /app/flow-server
COPY html /app/html

# Cloud Run injects $PORT; main.go reads it. Local docker run defaults to 8080.
ENV PORT=8080
EXPOSE 8080

USER nonroot:nonroot
ENTRYPOINT ["/app/flow-server", "-www", "/app/html"]
