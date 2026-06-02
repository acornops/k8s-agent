import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from './json-schema.js';

describe('zodToJsonSchema', () => {
  it('converts objects, enums, arrays, records, optionals, and defaults', () => {
    const schema = z.object({
      name: z.string(),
      mode: z.enum(['read', 'write']),
      retries: z.number().default(3),
      enabled: z.boolean().optional(),
      tags: z.array(z.string()),
      metadata: z.record(z.number()),
    });

    expect(zodToJsonSchema(schema)).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        name: { type: 'string' },
        mode: { type: 'string', enum: ['read', 'write'] },
        retries: { type: 'number' },
        enabled: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object', additionalProperties: { type: 'number' } },
      },
      required: ['name', 'mode', 'tags', 'metadata'],
      additionalProperties: false,
    });
  });
});
