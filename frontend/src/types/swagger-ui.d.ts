declare module "swagger-ui-dist/swagger-ui-bundle.js" {
  export type SwaggerUiInstance = {
    destroy?: () => void;
  };

  export type SwaggerUiOptions = {
    url?: string;
    domNode: Element;
    deepLinking?: boolean;
    displayRequestDuration?: boolean;
    docExpansion?: "list" | "full" | "none";
    filter?: boolean;
    persistAuthorization?: boolean;
    defaultModelsExpandDepth?: number;
    defaultModelExpandDepth?: number;
    presets?: unknown[];
    layout?: string;
  };

  type SwaggerUiBundle = {
    (options: SwaggerUiOptions): SwaggerUiInstance;
    presets: {
      apis: unknown;
    };
  };

  const swaggerUiBundle: SwaggerUiBundle;
  export default swaggerUiBundle;
}

declare module "swagger-ui-dist/swagger-ui-standalone-preset.js" {
  const swaggerUiStandalonePreset: unknown;
  export default swaggerUiStandalonePreset;
}
