const REDACTED = '<redacted>';

const SENSITIVE_KEY_PATTERN =
  /(^|[._/-])(secret|token|password|passwd|pwd|credential|credentials|auth|authorization|api[-_]?key|client[-_]?secret|private[-_]?key|cookie|session)([._/-]|$)/i;

const DROP_FIELDS = new Set(['managedFields']);
const REDACT_FIELD_NAMES = new Set(['providerID', 'providerId']);
const REDACT_ARRAY_FIELDS = new Set(['args', 'command']);
const SENSITIVE_FIELD_FRAGMENTS = [
  'secret',
  'token',
  'password',
  'passwd',
  'credential',
  'authorization',
  'apikey',
  'clientsecret',
  'privatekey',
  'cookie',
  'session',
];

/** Return whether a value is a plain object record. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Replace every defined value below this node with the redaction marker. */
function redactAll(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactAll);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).map((key) => [key, redactAll(value[key])]));
  }
  if (value === undefined) {
    return undefined;
  }
  return REDACTED;
}

/** Return whether an environment variable value field should be redacted. */
function shouldRedactEnvValue(key: string, parent: Record<string, unknown>, path: string[]): boolean {
  return key === 'value' && path[path.length - 1] === 'env' && typeof parent.name === 'string';
}

/** Return whether a field name appears to contain sensitive data. */
function isSensitiveFieldName(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_FIELD_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/** Recursively redact sensitive Kubernetes resource fields. */
function redactValue(value: unknown, path: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, path));
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (DROP_FIELDS.has(key)) {
      continue;
    }
    if (shouldRedactEnvValue(key, value, path)) {
      output[key] = REDACTED;
      continue;
    }
    if (REDACT_ARRAY_FIELDS.has(key) && Array.isArray(child)) {
      output[key] = child.length > 0 ? [REDACTED] : [];
      continue;
    }
    if (REDACT_FIELD_NAMES.has(key) || isSensitiveFieldName(key)) {
      output[key] = redactAll(child);
      continue;
    }
    output[key] = redactValue(child, [...path, key]);
  }
  return output;
}

/** Return a copy of a Kubernetes resource with sensitive fields redacted. */
export function redactKubernetesResource<T>(resource: T): T {
  return redactValue(resource, []) as T;
}

export { REDACTED };
