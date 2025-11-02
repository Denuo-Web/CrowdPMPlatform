# 🧭 Viewing the OpenAPI Spec in Swagger UI

This guide explains how to view your local `openapi.yaml` API specification using **Swagger UI** via Docker.  
You’ll get a fully interactive API documentation page that runs locally in your browser.

---

## 🐳 Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running  
- A valid `openapi.yaml` file in your project.

---

## 🚀 Run Swagger UI with Docker

From the root of your project, run:

```bash
docker pull swaggerapi/swagger-ui

docker run --rm -p 8080:8080 \
  -e SWAGGER_JSON=/openapi.yaml \
  -v ./functions/src/openapi.yaml:/openapi.yaml:ro \
  swaggerapi/swagger-ui
