import * as z from 'zod';

import { ApiError, ApiMeta, PageMeta } from '../common/envelope';
import { HealthzResponse } from '../system/healthz.schemas';
import { API_ROUTES, type ApiRoute } from './routes';

/**
 * OpenAPI 3.1 SINH từ Zod contracts (A2) — không viết tay. OpenAPI 3.1 dùng JSON Schema 2020-12 nên
 * `z.toJSONSchema` (Zod 4) dùng thẳng được. Request: schema phía `input` (trước transform/default);
 * response: phía `output`.
 */
type Json = Record<string, unknown>;

const toSchema = (schema: z.ZodType, io: 'input' | 'output'): Json => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'any',
  }) as Json;
  return rest;
};

/** Mỗi thuộc tính của object params/query ⇒ một `parameter`. */
function parametersOf(
  schema: z.ZodType | undefined,
  location: 'path' | 'query' | 'header',
): Json[] {
  if (!schema) return [];
  const json = toSchema(schema, 'input');
  const properties = (json['properties'] ?? {}) as Record<string, Json>;
  const required = new Set((json['required'] ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: location,
    required: location === 'path' || required.has(name),
    schema: property,
  }));
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 201: 'Đã tạo', 204: 'Không có nội dung' };

function successResponse(route: ApiRoute): Json {
  const { status, data, paged, csv, xlsx } = route.response;
  if (xlsx) {
    return {
      description: 'Bảng tính .xlsx (`Content-Disposition: attachment`) — ADR-130',
      content: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: { type: 'string', format: 'binary' },
        },
      },
    };
  }
  if (csv) {
    return {
      description: 'CSV UTF-8 có BOM (`Content-Disposition: attachment`)',
      content: { 'text/csv': { schema: { type: 'string' } } },
    };
  }
  if (status === 204 || !data) return { description: STATUS_TEXT[status] };
  const meta = paged ? ApiMeta.extend({ page: PageMeta }) : ApiMeta;
  const envelope = z.object({ success: z.literal(true), data, meta });
  return {
    description: STATUS_TEXT[status],
    content: { 'application/json': { schema: toSchema(envelope, 'output') } },
  };
}

function operationOf(route: ApiRoute): Json {
  const parameters = [
    ...parametersOf(route.params, 'path'),
    ...parametersOf(route.query, 'query'),
    ...parametersOf(route.headers, 'header'),
  ];
  const specific = route.errors?.length ? ` Mã lỗi đặc thù: ${route.errors.join(', ')}.` : '';
  return {
    operationId: `${route.method}_${route.path.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, '_')}`,
    summary: route.summary,
    tags: [route.tag],
    security:
      route.security === 'bearer'
        ? [{ bearerAuth: [] }]
        : route.security === 'refreshCookie'
          ? [{ refreshCookie: [] }]
          : [],
    ...(parameters.length ? { parameters } : {}),
    ...(route.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: toSchema(route.body, 'input') } },
          },
        }
      : {}),
    responses: {
      [String(route.response.status)]: successResponse(route),
      ...(route.response.alsoOk
        ? { 200: { ...successResponse(route), description: 'Lặp lại idempotent — thẻ hiện tại' } }
        : {}),
      default: {
        description: `Lỗi theo envelope chung (thứ tự 401 → 400 → 404 → 403 → 400 body → 422 → 409).${specific}`,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
      },
    },
  };
}

export interface OpenApiOptions {
  /** Phiên bản tài liệu (vd GIT_SHA). */
  version: string;
}

export function buildOpenApiDocument(options: OpenApiOptions): Json {
  const paths: Record<string, Json> = {};
  for (const route of API_ROUTES) {
    paths[route.path] = { ...(paths[route.path] ?? {}), [route.method]: operationOf(route) };
  }
  const root = [{ url: '/' }];
  paths['/healthz'] = {
    servers: root,
    get: {
      operationId: 'get_healthz',
      summary: 'Liveness (không chạm DB/Valkey)',
      tags: ['system'],
      security: [],
      responses: {
        200: {
          description: 'OK',
          content: { 'application/json': { schema: toSchema(HealthzResponse, 'output') } },
        },
      },
    },
  };
  paths['/readyz'] = {
    servers: root,
    get: {
      operationId: 'get_readyz',
      summary: 'Readiness (DB + Valkey, dùng chung kết quả 1 giây, 60/phút/IP)',
      tags: ['system'],
      security: [],
      responses: {
        200: { description: 'Sẵn sàng' },
        429: { description: 'Quá hạn mức' },
        503: { description: 'DB lỗi hoặc đang shutdown' },
      },
    },
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'TaskFlow API',
      version: options.version,
      description:
        'Sinh tự động từ Zod contracts (`packages/contracts`). Envelope: `{ success, data, meta }` / `{ success: false, error, meta }`. Chi tiết: docs/design/data-and-api.md.',
    },
    servers: [{ url: '/api/v1' }],
    tags: [
      'auth',
      'workspaces',
      'members',
      'projects',
      'tasks',
      'hr',
      'company',
      'notifications',
      'system',
    ].map((name) => ({
      name,
    })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        refreshCookie: { type: 'apiKey', in: 'cookie', name: '__Host-tf_rt' },
      },
      schemas: { ApiError: toSchema(ApiError, 'output') },
    },
  };
}
