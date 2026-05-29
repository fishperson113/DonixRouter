/**
 * Tuple schema conversion — bridges JSON Schema `prefixItems` (tuple) to
 * object-based representation that Codex upstream accepts.
 *
 * Request side:  convertTupleSchemas() rewrites prefixItems → properties with numeric keys
 * Response side: reconvertTupleValues() restores {"0":…,"1":…} back to […,…]
 *
 * JavaScript port of codex-proxy-dev/src/translation/tuple-schema.ts
 */

function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Detection ──────────────────────────────────────────────────────

/** Returns true if the schema tree contains any `prefixItems` node. */
export function hasTupleSchemas(schema) {
  return walk(schema, new Set());
}

function walk(node, seen) {
  if (seen.has(node)) return false;
  seen.add(node);

  if (Array.isArray(node.prefixItems)) return true;

  // properties
  if (isRecord(node.properties)) {
    for (const v of Object.values(node.properties)) {
      if (isRecord(v) && walk(v, seen)) return true;
    }
  }

  // items
  if (isRecord(node.items) && walk(node.items, seen)) return true;

  // combinators
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(node[key])) {
      for (const entry of node[key]) {
        if (isRecord(entry) && walk(entry, seen)) return true;
      }
    }
  }

  // $defs / definitions
  for (const key of ["$defs", "definitions"]) {
    if (isRecord(node[key])) {
      for (const v of Object.values(node[key])) {
        if (isRecord(v) && walk(v, seen)) return true;
      }
    }
  }

  // conditional
  for (const key of ["if", "then", "else", "not"]) {
    if (isRecord(node[key]) && walk(node[key], seen)) return true;
  }

  return false;
}

// ── Request-side conversion ────────────────────────────────────────

/**
 * Recursively convert `prefixItems` tuple schemas to equivalent object schemas.
 * Input must be a clone — this function mutates in place and returns the same reference.
 */
export function convertTupleSchemas(node) {
  return convertWalk(node, new Set());
}

function convertWalk(node, seen) {
  if (seen.has(node)) return node;
  seen.add(node);

  // Convert this node if it has prefixItems
  if (Array.isArray(node.prefixItems)) {
    const items = node.prefixItems;
    const properties = {};
    const required = [];

    for (let i = 0; i < items.length; i++) {
      const key = String(i);
      properties[key] = isRecord(items[i]) ? convertWalk(items[i], seen) : items[i];
      required.push(key);
    }

    node.type = "object";
    node.properties = properties;
    node.required = required;
    node.additionalProperties = false;
    delete node.prefixItems;
    delete node.items;
    return node;
  }

  // Recurse into properties
  if (isRecord(node.properties)) {
    for (const [k, v] of Object.entries(node.properties)) {
      if (isRecord(v)) node.properties[k] = convertWalk(v, seen);
    }
  }

  // Recurse into items
  if (isRecord(node.items)) {
    node.items = convertWalk(node.items, seen);
  }

  // Recurse into combinators
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(node[key])) {
      node[key] = node[key].map((entry) =>
        isRecord(entry) ? convertWalk(entry, seen) : entry,
      );
    }
  }

  // Recurse into $defs / definitions
  for (const key of ["$defs", "definitions"]) {
    if (isRecord(node[key])) {
      const defs = node[key];
      for (const [k, v] of Object.entries(defs)) {
        if (isRecord(v)) defs[k] = convertWalk(v, seen);
      }
    }
  }

  // Recurse into conditional
  for (const key of ["if", "then", "else", "not"]) {
    if (isRecord(node[key])) {
      node[key] = convertWalk(node[key], seen);
    }
  }

  return node;
}

// ── Response-side reconversion ─────────────────────────────────────

/**
 * Schema-guided recursive reconversion: turn {"0":…,"1":…} objects back to arrays
 * wherever the *original* schema had `prefixItems`.
 */
export function reconvertTupleValues(data, schema, rootSchema) {
  const root = rootSchema ?? schema;

  // Resolve $ref
  if (typeof schema.$ref === "string") {
    const resolved = resolveRef(schema.$ref, root);
    if (resolved) return reconvertTupleValues(data, resolved, root);
    return data;
  }

  // Tuple node: original schema has prefixItems → data should be {"0":…,"1":…} → convert to array
  if (Array.isArray(schema.prefixItems) && isRecord(data)) {
    const items = schema.prefixItems;
    const result = [];
    for (let i = 0; i < items.length; i++) {
      const key = String(i);
      const val = data[key];
      const itemSchema = items[i];
      result.push(isRecord(itemSchema) ? reconvertTupleValues(val, itemSchema, root) : val);
    }
    return result;
  }

  // Object with properties → recurse into each property
  if (isRecord(schema.properties) && isRecord(data)) {
    const result = { ...data };
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in result && isRecord(propSchema)) {
        result[key] = reconvertTupleValues(result[key], propSchema, root);
      }
    }
    return result;
  }

  // Array with items schema → recurse into each element
  if (isRecord(schema.items) && Array.isArray(data)) {
    return data.map((el) => reconvertTupleValues(el, schema.items, root));
  }

  // Combinators — try to find matching branch (heuristic: first branch that has prefixItems)
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(schema[key])) {
      for (const branch of schema[key]) {
        if (isRecord(branch) && hasTupleSchemas(branch)) {
          return reconvertTupleValues(data, branch, root);
        }
      }
    }
  }

  return data;
}

function resolveRef(ref, root) {
  // Only handle internal refs: #/$defs/Name or #/definitions/Name
  const match = ref.match(/^#\/(\$defs|definitions)\/(.+)$/);
  if (!match) return undefined;
  const defs = root[match[1]];
  if (!isRecord(defs)) return undefined;
  const resolved = defs[match[2]];
  return isRecord(resolved) ? resolved : undefined;
}
