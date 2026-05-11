# OpenAPI In Swagger UI

Use Swagger UI locally to inspect `functions/src/openapi.yaml`.

## Prerequisite

- Docker installed and running.

## Run

From the repository root:

```bash
docker run --rm -p 8080:8080 \
  -e SWAGGER_JSON=/openapi.yaml \
  -v ./functions/src/openapi.yaml:/openapi.yaml:ro \
  swaggerapi/swagger-ui
```

Open `http://localhost:8080`.

The OpenAPI document covers the Fastify API exported as `crowdpmApi`. The separate `ingestGateway` function is documented in `hardware-builder.md`.
