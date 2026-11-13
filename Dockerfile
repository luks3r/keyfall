# syntax=docker/dockerfile:1.7
#
# Three images from one file:
#   keyfall       (default) room server with the web app bundled: one static binary in an empty image
#   --target room room server only, for running several on their own machines
#   --target app  the web app only (nginx), listing room servers from KEYFALL_SERVERS
#
#   docker build -t keyfall .                          && docker run -p 7777:7777 keyfall
#   docker build --target room -t keyfall-room .       && docker run -p 7777:7777 keyfall-room --app https://keyfall.example
#   docker build --target app -t keyfall-app .         && docker run -p 8080:8080 -e KEYFALL_SERVERS=wss://rooms.example keyfall-app
# Server flags go after the image name (--name, --max-rooms, --rooms-per-ip, --port); later flags win.
# Stages run in parallel where they can (server and WASM build together); cache mounts keep crates.io,
# Cargo build output and Bun's package cache across builds, so a source edit rebuilds only what changed.

ARG RUST_VERSION=1.99
ARG BUN_VERSION=1.4.4
ARG NGINX_VERSION=stable-alpine

# Rust toolchain on musl, so the server links fully statically and runs on `scratch`.
FROM rust:${RUST_VERSION}-alpine AS rust
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
# The Tauri app is a workspace member but is never built here: its manifest plus empty targets satisfy Cargo,
# so editing the desktop app doesn't invalidate this image's layers.
COPY src-tauri/Cargo.toml src-tauri/
RUN mkdir -p src-tauri/src && touch src-tauri/src/lib.rs && echo 'fn main() {}' > src-tauri/src/main.rs

FROM rust AS server
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=keyfall-server-target,target=/src/target \
    cargo build --locked --release -p keyfall-room \
 && install -D target/release/keyfall-room /out/keyfall-room

FROM rust AS wasm
RUN rustup target add wasm32-unknown-unknown
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=keyfall-wasm-target,target=/src/target \
    cargo build --locked -p keyfall-dsp-wasm --target wasm32-unknown-unknown --profile wasm \
 && install -D target/wasm32-unknown-unknown/wasm/keyfall_dsp_wasm.wasm /out/dsp.wasm

FROM oven/bun:${BUN_VERSION}-alpine AS web
WORKDIR /src
COPY package.json bun.lock ./
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY index.html vite.config.ts svelte.config.js tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public public
COPY src src
COPY --from=wasm /out/dsp.wasm src/lib/audio/dsp.wasm
RUN bunx --bun vite build

# Room server only. With --app <url> it sends browsers that open it (invite links) to the web app.
# Liveness: GET /health (no shell or curl in these images for a Docker HEALTHCHECK).
FROM scratch AS room
COPY --from=server /out/keyfall-room /keyfall-room
USER 65534:65534
EXPOSE 7777
ENTRYPOINT ["/keyfall-room", "--host", "0.0.0.0", "--port", "7777"]

# Web app only, as static files; runs as an unprivileged user on port 8080.
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION} AS app
COPY deploy/app/isolation.conf /etc/nginx/keyfall-isolation.conf
COPY deploy/app/default.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 deploy/app/servers.sh /docker-entrypoint.d/40-keyfall-servers.sh
COPY --from=web /src/dist /usr/share/nginx/html
EXPOSE 8080

# Default: both in one.
FROM scratch AS keyfall
COPY --from=server /out/keyfall-room /keyfall-room
COPY --from=web /src/dist /dist
USER 65534:65534
EXPOSE 7777
ENTRYPOINT ["/keyfall-room", "--host", "0.0.0.0", "--port", "7777", "--static", "/dist"]
