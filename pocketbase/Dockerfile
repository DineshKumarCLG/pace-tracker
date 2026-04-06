FROM alpine:3.19 AS downloader

ARG PB_VERSION=0.25.9
ARG TARGETARCH=amd64

RUN apk add --no-cache wget unzip ca-certificates \
    && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
       -O /tmp/pocketbase.zip \
    && unzip /tmp/pocketbase.zip -d /tmp/pb \
    && rm /tmp/pocketbase.zip

FROM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=downloader /tmp/pb/pocketbase /app/pocketbase
COPY pb_hooks/ /app/pb_hooks/
COPY pb_migrations/ /app/pb_migrations/

RUN chmod +x /app/pocketbase \
    && mkdir -p /app/pb_data

EXPOSE 8090

CMD ["/app/pocketbase", "serve", "--http=0.0.0.0:8090"]
