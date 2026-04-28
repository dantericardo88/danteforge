/**
 * Lightweight JSON Schema validator for the six truth-loop schemas.
 * No external deps. Validates only the subset of Draft 2020-12 we use:
 * required, type, enum, pattern, format(date-time only), properties,
 * additionalProperties, minLength, minimum, maximum, minItems, items.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ValidationError {
  path: string;
  message: string;
}

export type SchemaName =
  | 'run'
  | 'artifact'
  | 'evidence'
  | 'verdict'
  | 'next_action'
  | 'budget_envelope';

const SCHEMA_DIR = resolve(__dirname, '..', 'schemas');

const schemaCache = new Map<SchemaName, unknown>();

export function loadSchema(name: SchemaName): unknown {
  const cached = schemaCache.get(name);
  if (cached) return cached;
  const path = resolve(SCHEMA_DIR, `${name}.schema.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  schemaCache.set(name, parsed);
  return parsed;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getField(schema: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(schema, key) ? schema[key] : undefined;
}

function validateNode(value: unknown, schema: unknown, path: string, errors: ValidationError[]): void {
  if (!isPlainObject(schema)) return;

  const typeField = getField(schema, 'type');
  if (typeof typeField === 'string') {
    if (!matchesType(value, typeField)) {
      errors.push({ path, message: `expected type ${typeField}` });
      return;
    }
  }

  const enumField = getField(schema, 'enum');
  if (Array.isArray(enumField)) {
    if (!enumField.includes(value as never)) {
      errors.push({ path, message: `value not in enum: ${JSON.stringify(enumField)}` });
    }
  }

  if (typeof value === 'string') {
    const minLen = getField(schema, 'minLength');
    if (typeof minLen === 'number' && value.length < minLen) {
      errors.push({ path, message: `string shorter than minLength ${minLen}` });
    }
    const pat = getField(schema, 'pattern');
    if (typeof pat === 'string' && !new RegExp(pat).test(value)) {
      errors.push({ path, message: `string does not match pattern /${pat}/` });
    }
    const fmt = getField(schema, 'format');
    if (fmt === 'date-time' && !ISO_DATETIME.test(value)) {
      errors.push({ path, message: `string not a valid ISO 8601 date-time` });
    }
  }

  if (typeof value === 'number') {
    const min = getField(schema, 'minimum');
    if (typeof min === 'number' && value < min) {
      errors.push({ path, message: `number below minimum ${min}` });
    }
    const max = getField(schema, 'maximum');
    if (typeof max === 'number' && value > max) {
      errors.push({ path, message: `number above maximum ${max}` });
    }
  }

  if (Array.isArray(value)) {
    const minItems = getField(schema, 'minItems');
    if (typeof minItems === 'number' && value.length < minItems) {
      errors.push({ path, message: `array shorter than minItems ${minItems}` });
    }
    const items = getField(schema, 'items');
    if (items) {
      value.forEach((item, idx) => validateNode(item, items, `${path}[${idx}]`, errors));
    }
  }

  if (isPlainObject(value)) {
    const required = getField(schema, 'required');
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === 'string' && !(key in value)) {
          errors.push({ path: path ? `${path}.${key}` : key, message: 'required field missing' });
        }
      }
    }
    const properties = getField(schema, 'properties');
    const propsRecord = isPlainObject(properties) ? properties : {};
    const additional = getField(schema, 'additionalProperties');
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (Object.prototype.hasOwnProperty.call(propsRecord, key)) {
        validateNode(child, propsRecord[key], childPath, errors);
      } else if (additional === false) {
        errors.push({ path: childPath, message: 'additional property not allowed' });
      }
    }
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function validate(name: SchemaName, value: unknown): ValidationResult {
  const schema = loadSchema(name);
  const errors: ValidationError[] = [];
  validateNode(value, schema, '', errors);
  return { valid: errors.length === 0, errors };
}

export function assertValid(name: SchemaName, value: unknown): void {
  const result = validate(name, value);
  if (!result.valid) {
    const detail = result.errors.map(e => `  - ${e.path || '(root)'}: ${e.message}`).join('\n');
    throw new Error(`Truth-loop ${name} schema validation failed:\n${detail}`);
  }
}
