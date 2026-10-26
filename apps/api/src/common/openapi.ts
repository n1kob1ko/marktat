import { z } from 'zod';

/** Erzeugt ein OpenAPI-3.0-kompatibles Schema aus einem zod-Schema für @ApiBody/@ApiQuery. */
export function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
}
