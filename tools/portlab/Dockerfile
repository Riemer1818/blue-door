# Deliberately boring. portlab exists to misbehave at the tool level, not at the
# image level - if the image is also strange, a failing conformance run has two
# possible causes instead of one.
FROM python:3.12-alpine
COPY portlab.py /usr/local/bin/portlab
RUN chmod +x /usr/local/bin/portlab
WORKDIR /work
ENTRYPOINT []
