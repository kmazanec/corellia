import { OpenAPIHono, type z } from '@hono/zod-openapi';

/**
 * The wire form of a read-model value: a JSON round-trip, which drops the
 * `undefined` members the schemas treat as absent, typed as the route's schema.
 */
export const wire = <S extends z.ZodType>(_schema: S, v: unknown): z.infer<S> => JSON.parse(JSON.stringify(v)) as z.infer<S>;

/**
 * An OpenAPI router whose validation failures answer like every other error
 * here: `400 { error }`, naming the first bad field.
 */
export function apiRouter(): OpenAPIHono {
  return new OpenAPIHono({
    defaultHook: (result, c) => {
      if (result.success) return;
      const issue = result.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      return c.json({ error: `${where}${issue?.message ?? 'invalid request'}` }, 400);
    },
  });
}
