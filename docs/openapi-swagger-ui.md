# OpenAPI In Swagger UI

Use Swagger UI to inspect `functions/src/openapi.yaml`.

## Hosted

Deployed frontend builds publish a live Swagger UI page at `/api-docs` on the
main app origin. The page bundles the OpenAPI file from `functions/src/openapi.yaml`
at build time, so it stays aligned with the shipped frontend artifact.

## Prerequisite

- Docker installed and running.

## Local Run

From the repository root:

```bash
docker run --rm -p 8080:8080 \
  -e SWAGGER_JSON=/openapi.yaml \
  -v ./functions/src/openapi.yaml:/openapi.yaml:ro \
  swaggerapi/swagger-ui
```

Open `http://localhost:8080`.

The OpenAPI document covers the Fastify API exported as `crowdpmApi`. The separate `ingestGateway` function is documented in `hardware-builder.md`.
