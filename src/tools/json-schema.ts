import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

/** Unwrap optional/default Zod wrappers and report whether the field is required. */
function unwrap(type: z.ZodTypeAny): { schema: z.ZodTypeAny; required: boolean } {
  let current = type;
  let required = true;
  while (true) {
    const typeName = (current as { _def?: { typeName?: string } })._def?.typeName;
    if (typeName === z.ZodFirstPartyTypeKind.ZodOptional || typeName === z.ZodFirstPartyTypeKind.ZodDefault) {
      required = false;
      current = (current as unknown as { _def: { innerType: z.ZodTypeAny } })._def.innerType;
      continue;
    }
    return { schema: current, required };
  }
}

/** Convert supported Zod schema nodes into JSON Schema fragments. */
function toJsonSchemaInternal(type: z.ZodTypeAny): JsonSchema {
  const typeName = (type as { _def?: { typeName?: string } })._def?.typeName;
  switch (typeName) {
    case z.ZodFirstPartyTypeKind.ZodString:
      return { type: 'string' };
    case z.ZodFirstPartyTypeKind.ZodNumber:
      return { type: 'number' };
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: 'boolean' };
    case z.ZodFirstPartyTypeKind.ZodAny:
      return {};
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return {
        type: 'string',
        enum: [...(type as z.ZodEnum<[string, ...string[]]>).options]
      };
    case z.ZodFirstPartyTypeKind.ZodRecord: {
      const valueType = (type as unknown as { _def: { valueType: z.ZodTypeAny } })._def.valueType;
      return {
        type: 'object',
        additionalProperties: toJsonSchemaInternal(valueType)
      };
    }
    case z.ZodFirstPartyTypeKind.ZodArray: {
      const elementType = (type as z.ZodArray<z.ZodTypeAny>).element;
      return {
        type: 'array',
        items: toJsonSchemaInternal(elementType)
      };
    }
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const objectSchema = type as z.ZodObject<Record<string, z.ZodTypeAny>>;
      const shape = objectSchema.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, rawSchema] of Object.entries(shape)) {
        const { schema, required: isRequired } = unwrap(rawSchema);
        properties[key] = toJsonSchemaInternal(schema);
        if (isRequired) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required,
        additionalProperties: false
      };
    }
    default:
      return {};
  }
}

/** Convert a Zod schema into a JSON Schema document. */
export function zodToJsonSchema(type: z.ZodTypeAny): JsonSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...toJsonSchemaInternal(type)
  };
}
