# faster - fast statistics and filtering for a fastx file
# https://github.com/angelovangel/faster  (MIT)
#
# Built from source: no BioContainers/bioconda package exists for this tool.
# The build is pinned to an exact upstream commit and uses the repository's
# checked-in Cargo.lock, so the dependency set is fixed rather than resolved
# afresh at build time.

FROM rust:1.79-slim AS build

ARG FASTER_REPO=https://github.com/angelovangel/faster.git
# HEAD of master on 2026-08-31; the tool self-reports 0.2.5 (Cargo.toml and
# the hard-coded clap version string both say 0.2.5), but this commit is ahead
# of any tagged release - it carries the --dust filter.
ARG FASTER_COMMIT=21b9657c5214c6c6dbc5440c3378c3381036c9d6

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates cmake build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git init . \
 && git remote add origin "$FASTER_REPO" \
 && git fetch --depth 1 origin "$FASTER_COMMIT" \
 && git checkout FETCH_HEAD

# The committed Cargo.lock is stale in exactly one field: it still records the
# workspace crate itself as 0.2.4 while Cargo.toml says 0.2.5. Every third-party
# dependency in the lock is already consistent (bio 0.32.0, clap 3.2.25,
# kseq 0.5.3, rayon 1.10.0, regex 1.4.1, indicatif 0.17.8). Correcting only that
# one line lets --locked hold, which pins the whole dependency graph to what
# upstream committed. Without it cargo would re-resolve `bio = "*"` from
# Cargo.toml at build time and the image would drift between rebuilds.
RUN sed -i '/^name = "faster"$/{n;s/^version = "0.2.4"$/version = "0.2.5"/}' Cargo.lock \
 && grep -A1 '^name = "faster"$' Cargo.lock

RUN cargo build --release --locked

FROM debian:bookworm-slim

LABEL org.opencontainers.image.title="faster" \
      org.opencontainers.image.description="fast statistics and filtering for a fastx file" \
      org.opencontainers.image.source="https://github.com/angelovangel/faster" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="0.2.5"

COPY --from=build /src/target/release/faster /usr/local/bin/faster
COPY --from=build /src/LICENSE /usr/share/doc/faster/LICENSE

# No ENTRYPOINT: the runner appends argv directly to `docker run <image>`.
ENTRYPOINT []
WORKDIR /work
CMD ["faster", "--help"]
