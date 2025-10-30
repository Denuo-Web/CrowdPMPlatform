# 🧭 Viewing the OpenAPI Spec in Swagger UI

This guide explains how to view your local `openapi.yaml` API specification using **Swagger UI** via Docker.  
You’ll get a fully interactive API documentation page that runs locally in your browser.

---

## 🐳 Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running  
- A valid `openapi.yaml` file in your project directory (e.g., `./openapi.yaml`)

---

## 🚀 Run Swagger UI with Docker

From the root of your project (where your `openapi.yaml` lives), run:

```bash
docker pull swaggerapi/swagger-ui

docker run -p 8080:8080 \
  -e SWAGGER_JSON=/openapi.yaml \
  -v $(pwd)/openapi.yaml:/openapi.yaml \
  swaggerapi/swagger-ui
