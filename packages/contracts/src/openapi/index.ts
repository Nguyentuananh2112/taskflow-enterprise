// Subpath `@taskflow/contracts/openapi` — KHÔNG export từ index gốc: web không kéo generator vào bundle.
export { API_ROUTES, type ApiRoute, type HttpMethod, type Security, type Tag } from './routes';
export { buildOpenApiDocument, type OpenApiOptions } from './document';
