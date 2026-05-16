import { useEffect, useRef } from "react";
import { Box, Card, Flex, Heading, Link, Text } from "@radix-ui/themes";
import SwaggerUIBundle from "swagger-ui-dist/swagger-ui-bundle.js";
import SwaggerUIStandalonePreset from "swagger-ui-dist/swagger-ui-standalone-preset.js";
import "swagger-ui-dist/swagger-ui.css";
import openapiSpecUrl from "../../../functions/src/openapi.yaml?url";
import "./ApiDocsPage.css";

const SWAGGER_LAYOUT = "BaseLayout";

export default function ApiDocsPage() {
  const swaggerContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = swaggerContainerRef.current;
    if (!container) return;

    const swaggerUi = SwaggerUIBundle({
      url: openapiSpecUrl,
      domNode: container,
      deepLinking: true,
      displayRequestDuration: true,
      docExpansion: "list",
      filter: true,
      persistAuthorization: true,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 1,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: SWAGGER_LAYOUT,
    });

    return () => {
      swaggerUi.destroy?.();
      container.replaceChildren();
    };
  }, []);

  return (
    <Flex className="api-docs-page" direction="column" gap="4">
      <Box>
        <Heading as="h1" size="5">API Reference</Heading>
        <Text as="p" size="2" color="gray" mt="2">
          Live Swagger UI for the CrowdPM REST API, bundled from the repository OpenAPI document.
        </Text>
      </Box>

      <Card>
        <Flex direction="column" gap="2">
          <Text as="p" size="2">
            Authentication and admin endpoints are documented here because they are part of the shipped contract.
            Publishing this page is appropriate when that discoverability is intentional and authorization remains the
            real access boundary.
          </Text>
          <Text as="p" size="2">
            The raw OpenAPI file is also available at{" "}
            <Link href={openapiSpecUrl} highContrast>
              this generated spec URL
            </Link>.
          </Text>
        </Flex>
      </Card>

      <Box
        ref={swaggerContainerRef}
        style={{
          minHeight: 720,
          overflow: "hidden",
        }}
      />
    </Flex>
  );
}
