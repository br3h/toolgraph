/**
 * The compatibility checker.
 *
 * This is the whole point of toolgraph: deciding, before anything runs, whether
 * one MCP tool's output can legally feed another MCP tool's input.
 *
 * The question it answers is **assignability**, not equality. A source is
 * compatible with a target when every value the source can produce is a value
 * the target will accept. That asymmetry matters everywhere: an `integer` may
 * feed a `number`, a required field may feed an optional one, and a narrow enum
 * may feed a wider one — never the reverse.
 *
 * Two severities exist because schemas in the wild are frequently
 * under-specified rather than actually wrong:
 *
 *   `error`   — this will break at runtime. The connection is refused.
 *   `warning` — this cannot be *proven* safe, but is probably fine. Allowed,
 *               with the caveat surfaced on the canvas.
 *
 * Refusing every under-specified schema would make the product unusable against
 * real servers; accepting them silently would make it useless. Hence both.
 */

import type {
  CompatibilityIssue,
  CompatibilityIssueCode,
  CompatibilityResult,
  JsonSchema,
  JsonSchemaType,
} from './types';
import { normalizeSchema, parsePointer, resolvePointer, resolveRef } from './pointer';
import { normalizeTypes, typeLabel } from './fields';

/** Structural recursion stops here. Deeper than this is not a real payload. */
const MAX_DEPTH = 24;

/** Total `$ref` resolutions allowed per check, across the whole walk. */
const MAX_REF_BUDGET = 64;

export interface CheckConnectionArgs {
  /** The source tool's whole output schema. Undefined when it declares none. */
  sourceSchema: JsonSchema | undefined;
  /** Which part of the source output feeds the edge. `""` is the whole value. */
  sourcePointer: string;
  /** The target tool's whole input schema. */
  targetSchema: JsonSchema;
  /** Which target field the edge feeds. `""` is the whole input object. */
  targetPointer: string;
  /** Document `$ref`s resolve against. Defaults to the schema itself. */
  sourceRoot?: JsonSchema;
  targetRoot?: JsonSchema;
  /** Names used in messages, e.g. the tool names. Optional but much clearer. */
  sourceLabel?: string;
  targetLabel?: string;
}

interface CheckContext {
  sourceRoot: JsonSchema | undefined;
  targetRoot: JsonSchema | undefined;
  depth: number;
  /** Shared across the whole walk so a wide schema cannot multiply the budget. */
  refBudget: { used: number };
  /** Pointer to the current location, relative to the connection's target field. */
  path: string;
  /** How to name the field being discussed in a message. */
  fieldName: string;
  sourceLabel: string | undefined;
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                          */
/* -------------------------------------------------------------------------- */

export function checkConnection(args: CheckConnectionArgs): CompatibilityResult {
  const {
    sourceSchema,
    sourcePointer,
    targetSchema,
    targetPointer,
    sourceRoot,
    targetRoot,
    sourceLabel,
    targetLabel,
  } = args;

  const targetField = fieldNameFor(targetPointer, targetLabel);

  // A server that omits `outputSchema` is common and entirely legal. Nothing can
  // be proven about it, so warn rather than block — refusing here would make
  // toolgraph unusable against a large slice of real servers.
  if (!sourceSchema) {
    return {
      compatible: true,
      issues: [
        {
          code: 'unknown_source_schema',
          severity: 'warning',
          path: '',
          expected: typeLabelAt(targetSchema, targetPointer, targetRoot),
          actual: 'unknown',
          message: sourceLabel
            ? `\`${sourceLabel}\` does not declare an output schema, so the type feeding \`${targetField}\` cannot be checked.`
            : `The source does not declare an output schema, so the type feeding \`${targetField}\` cannot be checked.`,
        },
      ],
    };
  }

  const effectiveSourceRoot = sourceRoot ?? sourceSchema;
  const effectiveTargetRoot = targetRoot ?? targetSchema;

  const resolvedSource = resolvePointer(sourceSchema, sourcePointer, effectiveSourceRoot);
  if (!resolvedSource) {
    // A dangling `$ref` and a pointer that addresses nothing both fail to
    // resolve, but they are different problems for the user: one is a defect in
    // the server's schema, the other is a stale handle on the canvas.
    if (hasUnresolvableRef(sourceSchema, sourcePointer, effectiveSourceRoot)) {
      return failure({
        code: 'unresolved_ref',
        severity: 'error',
        path: '',
        expected: typeLabelAt(targetSchema, targetPointer, effectiveTargetRoot),
        actual: 'an unresolved $ref',
        message: `The source schema feeding \`${targetField}\` contains a \`$ref\` that could not be resolved.`,
      });
    }
    return failure({
      code: 'pointer_not_found',
      severity: 'error',
      path: '',
      expected: typeLabelAt(targetSchema, targetPointer, effectiveTargetRoot),
      actual: 'nothing',
      message: `The source has no field at \`${displayPointer(sourcePointer)}\`, so nothing can feed \`${targetField}\`.`,
    });
  }

  const resolvedTarget = resolvePointer(targetSchema, targetPointer, effectiveTargetRoot);
  if (!resolvedTarget) {
    if (hasUnresolvableRef(targetSchema, targetPointer, effectiveTargetRoot)) {
      return failure({
        code: 'unresolved_ref',
        severity: 'error',
        path: '',
        expected: 'a resolvable schema',
        actual: 'an unresolved $ref',
        message: `The target schema for \`${targetField}\` contains a \`$ref\` that could not be resolved.`,
      });
    }
    return failure({
      code: 'pointer_not_found',
      severity: 'error',
      path: '',
      expected: 'nothing',
      actual: typeLabel(resolvedSource, effectiveSourceRoot),
      message: `The target has no field at \`${displayPointer(targetPointer)}\`.`,
    });
  }

  const issues = isSubschema(resolvedSource, resolvedTarget, {
    sourceRoot: effectiveSourceRoot,
    targetRoot: effectiveTargetRoot,
    depth: 0,
    refBudget: { used: 0 },
    path: '',
    fieldName: targetField,
    sourceLabel,
  });

  return {
    compatible: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}

function failure(issue: CompatibilityIssue): CompatibilityResult {
  return { compatible: false, issues: [issue] };
}

/* -------------------------------------------------------------------------- */
/* The recursive check                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Collect every reason `source` is not assignable to `target`.
 *
 * An empty array means fully compatible. An array containing only warnings means
 * allowed-but-unproven.
 */
export function isSubschema(
  source: JsonSchema,
  target: JsonSchema,
  context?: Partial<CheckContext>,
): CompatibilityIssue[] {
  const ctx: CheckContext = {
    sourceRoot: context?.sourceRoot,
    targetRoot: context?.targetRoot,
    depth: context?.depth ?? 0,
    refBudget: context?.refBudget ?? { used: 0 },
    path: context?.path ?? '',
    fieldName: context?.fieldName ?? 'value',
    sourceLabel: context?.sourceLabel,
  };

  if (ctx.depth >= MAX_DEPTH || ctx.refBudget.used >= MAX_REF_BUDGET) {
    return [
      issue(ctx, {
        code: 'depth_limit_exceeded',
        severity: 'warning',
        expected: 'a bounded schema',
        actual: 'a deeply nested or recursive schema',
        message: `\`${ctx.fieldName}\` is nested more deeply than toolgraph checks, so the innermost types were not compared.`,
      }),
    ];
  }
  ctx.refBudget.used += 1;

  const src = normalizeSchema(source, ctx.sourceRoot);
  const tgt = normalizeSchema(target, ctx.targetRoot);

  // A `$ref` that never resolved is a genuine defect in the server's schema.
  if (!src) return [refFailure(ctx, 'source')];
  if (!tgt) return [refFailure(ctx, 'target')];

  // A target with no constraints at all accepts anything.
  if (acceptsAnything(tgt)) return [];

  const issues: CompatibilityIssue[] = [];

  /* --- unions ---------------------------------------------------------- */

  // The source may produce ANY of its branches, so EVERY branch must fit.
  const sourceBranches = unionBranches(src);
  if (sourceBranches) {
    for (const branch of sourceBranches) {
      const resolved = normalizeSchema(branch, ctx.sourceRoot);
      if (!resolved) continue;
      issues.push(...isSubschema(resolved, tgt, { ...ctx, depth: ctx.depth + 1 }));
    }
    return dedupe(issues);
  }

  // The target accepts ANY of its branches, so ONE fitting branch is enough.
  const targetBranches = unionBranches(tgt);
  if (targetBranches) {
    let bestWarnings: CompatibilityIssue[] | null = null;

    for (const branch of targetBranches) {
      const resolved = normalizeSchema(branch, ctx.targetRoot);
      if (!resolved) continue;
      const branchIssues = isSubschema(src, resolved, {
        ...ctx,
        depth: ctx.depth + 1,
      });
      const errors = branchIssues.filter((i) => i.severity === 'error');
      if (errors.length === 0) {
        // Keep the least noisy passing branch's caveats, if any.
        if (bestWarnings === null || branchIssues.length < bestWarnings.length) {
          bestWarnings = branchIssues;
        }
        if (branchIssues.length === 0) return [];
      }
    }

    if (bestWarnings !== null) return bestWarnings;

    return [
      issue(ctx, {
        code: 'union_no_compatible_branch',
        severity: 'error',
        expected: typeLabel(tgt, ctx.targetRoot),
        actual: typeLabel(src, ctx.sourceRoot),
        message: `Field \`${ctx.fieldName}\` expects ${typeLabel(tgt, ctx.targetRoot)}, but ${describeSource(ctx)} provides ${typeLabel(src, ctx.sourceRoot)}, which matches none of the accepted forms.`,
      }),
    ];
  }

  /* --- literals and enumerations --------------------------------------- */

  issues.push(...checkEnum(src, tgt, ctx));

  /* --- types ------------------------------------------------------------ */

  const typeIssues = checkTypes(src, tgt, ctx);
  issues.push(...typeIssues);

  // If the types are outright incompatible, recursing into their members would
  // only produce noise the user has to read past.
  if (typeIssues.some((i) => i.severity === 'error')) return dedupe(issues);

  const targetTypes = new Set(normalizeTypes(tgt.type));
  const sourceTypes = new Set(normalizeTypes(src.type));
  const bothCould = (t: JsonSchemaType) =>
    (targetTypes.size === 0 || targetTypes.has(t)) &&
    (sourceTypes.size === 0 || sourceTypes.has(t));

  if (bothCould('object')) issues.push(...checkObject(src, tgt, ctx));
  if (bothCould('array')) issues.push(...checkArray(src, tgt, ctx));
  if (bothCould('string')) issues.push(...checkString(src, tgt, ctx));
  if (bothCould('number') || bothCould('integer')) issues.push(...checkNumber(src, tgt, ctx));

  return dedupe(issues);
}

/* -------------------------------------------------------------------------- */
/* Type assignability                                                          */
/* -------------------------------------------------------------------------- */

function checkTypes(src: JsonSchema, tgt: JsonSchema, ctx: CheckContext): CompatibilityIssue[] {
  const targetTypes = normalizeTypes(tgt.type);
  // A target that names no type constrains nothing.
  if (targetTypes.length === 0) return [];

  const sourceTypes = normalizeTypes(src.type);

  // An untyped source *might* satisfy a typed target. That is unprovable rather
  // than wrong, so it warns instead of blocking.
  if (sourceTypes.length === 0) {
    return [
      issue(ctx, {
        code: 'type_mismatch',
        severity: 'warning',
        expected: typeLabel(tgt, ctx.targetRoot),
        actual: 'unknown',
        message: `Field \`${ctx.fieldName}\` expects ${typeLabel(tgt, ctx.targetRoot)}, but ${describeSource(ctx)} does not declare a type, so this cannot be verified.`,
      }),
    ];
  }

  const unassignable = sourceTypes.filter(
    (sourceType) => !targetTypes.some((targetType) => typeAssignable(sourceType, targetType)),
  );
  if (unassignable.length === 0) return [];

  return [
    issue(ctx, {
      code: 'type_mismatch',
      severity: 'error',
      expected: typeLabel(tgt, ctx.targetRoot),
      actual: typeLabel(src, ctx.sourceRoot),
      message: `Field \`${ctx.fieldName}\` expects ${typeLabel(tgt, ctx.targetRoot)}, but ${describeSource(ctx)} provides ${typeLabel(src, ctx.sourceRoot)}.`,
    }),
  ];
}

/**
 * Whether a value of `sourceType` is always a valid `targetType`.
 *
 * The only widening JSON Schema permits is integer into number. Everything else
 * must match exactly — notably, number does NOT flow into integer, because
 * `1.5` is a number and is not an integer.
 */
function typeAssignable(sourceType: JsonSchemaType, targetType: JsonSchemaType): boolean {
  if (sourceType === targetType) return true;
  if (sourceType === 'integer' && targetType === 'number') return true;
  return false;
}

/* -------------------------------------------------------------------------- */
/* Enumerations                                                                */
/* -------------------------------------------------------------------------- */

function checkEnum(src: JsonSchema, tgt: JsonSchema, ctx: CheckContext): CompatibilityIssue[] {
  const targetValues = allowedValues(tgt);
  // An unconstrained target accepts every value.
  if (!targetValues) return [];

  const sourceValues = allowedValues(src);

  // The source can produce anything; the target only accepts a fixed set. That
  // is unprovable rather than certainly broken, so it warns.
  if (!sourceValues) {
    return [
      issue(ctx, {
        code: 'enum_not_subset',
        severity: 'warning',
        expected: typeLabel(tgt, ctx.targetRoot),
        actual: typeLabel(src, ctx.sourceRoot),
        message: `Field \`${ctx.fieldName}\` only accepts ${typeLabel(tgt, ctx.targetRoot)}, but ${describeSource(ctx)} is not restricted to those values.`,
      }),
    ];
  }

  const allowed = new Set(targetValues.map(stableKey));
  const extras = sourceValues.filter((value) => !allowed.has(stableKey(value)));
  if (extras.length === 0) return [];

  return [
    issue(ctx, {
      code: 'enum_not_subset',
      severity: 'error',
      expected: typeLabel(tgt, ctx.targetRoot),
      actual: typeLabel(src, ctx.sourceRoot),
      message: `Field \`${ctx.fieldName}\` only accepts ${typeLabel(tgt, ctx.targetRoot)}, but ${describeSource(ctx)} can also provide ${extras
        .slice(0, 3)
        .map((v) => JSON.stringify(v))
        .join(', ')}.`,
    }),
  ];
}

/** The finite value set a schema permits, or null when it is unconstrained. */
function allowedValues(schema: JsonSchema): unknown[] | null {
  if (schema.const !== undefined) return [schema.const];
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum;
  return null;
}

/** Structural identity for enum members, so `{a:1}` and `{a:1}` compare equal. */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return `${typeof value}:${String(value)}`;
  try {
    return JSON.stringify(value, Object.keys(value as object).sort());
  } catch {
    return 'unserialisable';
  }
}

/* -------------------------------------------------------------------------- */
/* Objects                                                                     */
/* -------------------------------------------------------------------------- */

function checkObject(src: JsonSchema, tgt: JsonSchema, ctx: CheckContext): CompatibilityIssue[] {
  const targetProperties = tgt.properties;
  const issues: CompatibilityIssue[] = [];

  const sourceProperties = src.properties ?? {};
  const sourceRequired = new Set(src.required ?? []);
  const targetRequired = new Set(tgt.required ?? []);

  if (targetProperties) {
    for (const [key, rawTargetChild] of Object.entries(targetProperties)) {
      const childPath = joinPath(ctx.path, key);
      const childName = joinName(ctx.fieldName, key);
      const rawSourceChild = sourceProperties[key];

      if (!rawSourceChild) {
        if (targetRequired.has(key)) {
          const targetChild = normalizeSchema(rawTargetChild, ctx.targetRoot);
          issues.push({
            code: 'missing_required_property',
            severity: 'error',
            path: childPath,
            expected: typeLabel(targetChild, ctx.targetRoot),
            actual: 'nothing',
            message: `Field \`${childName}\` is required, but ${describeSource(ctx)} does not provide it.`,
          });
        }
        // An optional property the source omits is simply not sent. Fine.
        continue;
      }

      const sourceChild = normalizeSchema(rawSourceChild, ctx.sourceRoot);
      const targetChild = normalizeSchema(rawTargetChild, ctx.targetRoot);
      if (!sourceChild || !targetChild) continue;

      // Present on both sides, but the source may omit it at runtime while the
      // target insists on having it. That is a real, and easily missed, bug.
      if (targetRequired.has(key) && !sourceRequired.has(key)) {
        issues.push({
          code: 'optional_feeds_required',
          severity: 'error',
          path: childPath,
          expected: typeLabel(targetChild, ctx.targetRoot),
          actual: `${typeLabel(sourceChild, ctx.sourceRoot)} (optional)`,
          message: `Field \`${childName}\` is required, but ${describeSource(ctx)} only provides it optionally.`,
        });
      }

      issues.push(
        ...isSubschema(sourceChild, targetChild, {
          ...ctx,
          depth: ctx.depth + 1,
          path: childPath,
          fieldName: childName,
        }),
      );
    }
  }

  // A closed target rejects keys it does not declare. Most runtimes ignore
  // extras, so this is a caveat rather than a refusal.
  if (tgt.additionalProperties === false && targetProperties) {
    const declared = new Set(Object.keys(targetProperties));
    const extras = Object.keys(sourceProperties).filter((key) => !declared.has(key));
    const sourceIsOpen = src.additionalProperties !== false && !src.properties;

    if (extras.length > 0 || sourceIsOpen) {
      issues.push(
        issue(ctx, {
          code: 'additional_properties_forbidden',
          severity: 'warning',
          expected: `an object with only ${[...declared].slice(0, 3).join(', ')}`,
          actual:
            extras.length > 0
              ? `an object also containing ${extras.slice(0, 3).join(', ')}`
              : 'an open object',
          message:
            extras.length > 0
              ? `Field \`${ctx.fieldName}\` does not declare ${extras
                  .slice(0, 3)
                  .map((e) => `\`${e}\``)
                  .join(
                    ', ',
                  )}, which ${describeSource(ctx)} also provides. Most servers ignore extra keys, but strict ones reject them.`
              : `Field \`${ctx.fieldName}\` rejects undeclared keys, and ${describeSource(ctx)} may provide them.`,
        }),
      );
    }
  }

  if (typeof tgt.minProperties === 'number') {
    const sourceMin =
      typeof src.minProperties === 'number' ? src.minProperties : sourceRequired.size;
    if (sourceMin < tgt.minProperties) {
      issues.push(
        issue(ctx, {
          code: 'constraint_not_guaranteed',
          severity: 'warning',
          expected: `at least ${tgt.minProperties} properties`,
          actual: `at least ${sourceMin}`,
          message: `Field \`${ctx.fieldName}\` requires at least ${tgt.minProperties} properties, which ${describeSource(ctx)} does not guarantee.`,
        }),
      );
    }
  }

  return issues;
}

/* -------------------------------------------------------------------------- */
/* Arrays                                                                      */
/* -------------------------------------------------------------------------- */

function checkArray(src: JsonSchema, tgt: JsonSchema, ctx: CheckContext): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];

  const targetPrefix = tgt.prefixItems;
  const sourcePrefix = src.prefixItems;

  if (Array.isArray(targetPrefix)) {
    // The target is a tuple. The source must supply at least as many positions
    // as the target requires, and each must be compatible.
    const targetMin = typeof tgt.minItems === 'number' ? tgt.minItems : targetPrefix.length;
    const sourceLength = Array.isArray(sourcePrefix)
      ? sourcePrefix.length
      : typeof src.minItems === 'number'
        ? src.minItems
        : undefined;

    if (sourceLength !== undefined && sourceLength < targetMin) {
      issues.push(
        issue(ctx, {
          code: 'tuple_arity_mismatch',
          severity: 'error',
          expected: `${targetMin} or more elements`,
          actual: `${sourceLength}`,
          message: `Field \`${ctx.fieldName}\` expects at least ${targetMin} elements, but ${describeSource(ctx)} provides ${sourceLength}.`,
        }),
      );
    }

    for (let index = 0; index < targetPrefix.length; index++) {
      const rawTargetItem = targetPrefix[index];
      if (!rawTargetItem) continue;
      const rawSourceItem = Array.isArray(sourcePrefix) ? sourcePrefix[index] : src.items;
      if (!rawSourceItem) continue;

      const targetItem = normalizeSchema(rawTargetItem, ctx.targetRoot);
      const sourceItem = normalizeSchema(rawSourceItem, ctx.sourceRoot);
      if (!targetItem || !sourceItem) continue;

      const childPath = joinPath(ctx.path, String(index));
      issues.push(
        ...isSubschema(sourceItem, targetItem, {
          ...ctx,
          depth: ctx.depth + 1,
          path: childPath,
          fieldName: `${ctx.fieldName}[${index}]`,
        }).map((child) =>
          child.code === 'type_mismatch'
            ? { ...child, code: 'array_item_mismatch' as CompatibilityIssueCode }
            : child,
        ),
      );
    }

    return issues;
  }

  const rawTargetItems = tgt.items;
  if (rawTargetItems) {
    const targetItems = normalizeSchema(rawTargetItems, ctx.targetRoot);
    const rawSourceItems = src.items ?? (Array.isArray(sourcePrefix) ? sourcePrefix[0] : undefined);
    const sourceItems = normalizeSchema(rawSourceItems, ctx.sourceRoot);

    if (targetItems && sourceItems) {
      issues.push(
        ...isSubschema(sourceItems, targetItems, {
          ...ctx,
          depth: ctx.depth + 1,
          path: joinPath(ctx.path, '0'),
          fieldName: `${ctx.fieldName}[]`,
        }).map((child) =>
          child.code === 'type_mismatch'
            ? { ...child, code: 'array_item_mismatch' as CompatibilityIssueCode }
            : child,
        ),
      );
    } else if (targetItems && !sourceItems) {
      issues.push(
        issue(ctx, {
          code: 'array_item_mismatch',
          severity: 'warning',
          expected: `Array<${typeLabel(targetItems, ctx.targetRoot)}>`,
          actual: 'Array<unknown>',
          message: `Field \`${ctx.fieldName}\` expects Array<${typeLabel(targetItems, ctx.targetRoot)}>, but ${describeSource(ctx)} does not declare its element type.`,
        }),
      );
    }
  }

  if (typeof tgt.minItems === 'number') {
    const sourceMin = typeof src.minItems === 'number' ? src.minItems : 0;
    if (sourceMin < tgt.minItems) {
      issues.push(
        issue(ctx, {
          code: 'constraint_not_guaranteed',
          severity: 'warning',
          expected: `at least ${tgt.minItems} elements`,
          actual: sourceMin > 0 ? `at least ${sourceMin}` : 'any number of elements',
          message: `Field \`${ctx.fieldName}\` requires at least ${tgt.minItems} elements, which ${describeSource(ctx)} does not guarantee.`,
        }),
      );
    }
  }

  return issues;
}

/* -------------------------------------------------------------------------- */
/* Strings and numbers                                                         */
/* -------------------------------------------------------------------------- */

function checkString(src: JsonSchema, tgt: JsonSchema, ctx: CheckContext): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];

  // A target that wants an email and a source that promises only "a string"
  // is the classic silent breakage this product exists to catch.
  if (typeof tgt.format === 'string' && tgt.format !== src.format) {
    issues.push(
      issue(ctx, {
        code: 'format_mismatch',
        severity: 'warning',
        expected: `string (${tgt.format})`,
        actual: typeof src.format === 'string' ? `string (${src.format})` : 'string',
        message: `Field \`${ctx.fieldName}\` expects a string formatted as ${tgt.format}, which ${describeSource(ctx)} does not guarantee.`,
      }),
    );
  }

  if (typeof tgt.pattern === 'string' && tgt.pattern !== src.pattern) {
    issues.push(
      issue(ctx, {
        code: 'constraint_not_guaranteed',
        severity: 'warning',
        expected: `a string matching /${tgt.pattern}/`,
        actual: 'an unconstrained string',
        message: `Field \`${ctx.fieldName}\` must match /${tgt.pattern}/, which ${describeSource(ctx)} does not guarantee.`,
      }),
    );
  }

  issues.push(
    ...boundIssue(ctx, 'minLength', tgt.minLength, src.minLength, 'at least', 'characters', 'min'),
  );
  issues.push(
    ...boundIssue(ctx, 'maxLength', tgt.maxLength, src.maxLength, 'at most', 'characters', 'max'),
  );

  return issues;
}

function checkNumber(src: JsonSchema, tgt: JsonSchema, ctx: CheckContext): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  issues.push(...boundIssue(ctx, 'minimum', tgt.minimum, src.minimum, 'at least', '', 'min'));
  issues.push(...boundIssue(ctx, 'maximum', tgt.maximum, src.maximum, 'at most', '', 'max'));

  if (typeof tgt.multipleOf === 'number' && src.multipleOf !== tgt.multipleOf) {
    issues.push(
      issue(ctx, {
        code: 'constraint_not_guaranteed',
        severity: 'warning',
        expected: `a multiple of ${tgt.multipleOf}`,
        actual: 'any number',
        message: `Field \`${ctx.fieldName}\` must be a multiple of ${tgt.multipleOf}, which ${describeSource(ctx)} does not guarantee.`,
      }),
    );
  }

  return issues;
}

/**
 * A bound the target sets that the source does not provably satisfy.
 *
 * For a minimum, the source is safe only when its own minimum is at least as
 * high; for a maximum, only when its own maximum is no higher.
 */
function boundIssue(
  ctx: CheckContext,
  keyword: string,
  targetBound: number | undefined,
  sourceBound: number | undefined,
  phrase: string,
  unit: string,
  direction: 'min' | 'max',
): CompatibilityIssue[] {
  if (typeof targetBound !== 'number') return [];

  const satisfied =
    typeof sourceBound === 'number' &&
    (direction === 'min' ? sourceBound >= targetBound : sourceBound <= targetBound);
  if (satisfied) return [];

  const suffix = unit ? ` ${unit}` : '';
  return [
    issue(ctx, {
      code: 'constraint_not_guaranteed',
      severity: 'warning',
      expected: `${phrase} ${targetBound}${suffix}`,
      actual:
        typeof sourceBound === 'number' ? `${phrase} ${sourceBound}${suffix}` : 'unconstrained',
      message: `Field \`${ctx.fieldName}\` requires ${phrase} ${targetBound}${suffix} (\`${keyword}\`), which ${describeSource(ctx)} does not guarantee.`,
    }),
  ];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function unionBranches(schema: JsonSchema): JsonSchema[] | null {
  const branches = schema.anyOf ?? schema.oneOf;
  if (!Array.isArray(branches) || branches.length === 0) return null;
  return branches;
}

/** A schema with no type, no enum, no composition and no members. */
function acceptsAnything(schema: JsonSchema): boolean {
  return (
    normalizeTypes(schema.type).length === 0 &&
    schema.enum === undefined &&
    schema.const === undefined &&
    schema.anyOf === undefined &&
    schema.oneOf === undefined &&
    schema.properties === undefined &&
    schema.required === undefined &&
    schema.items === undefined &&
    schema.prefixItems === undefined
  );
}

function issue(ctx: CheckContext, partial: Omit<CompatibilityIssue, 'path'>): CompatibilityIssue {
  return { ...partial, path: ctx.path };
}

function refFailure(ctx: CheckContext, side: 'source' | 'target'): CompatibilityIssue {
  return issue(ctx, {
    code: 'unresolved_ref',
    severity: 'error',
    expected: side === 'target' ? 'a resolvable schema' : 'any schema',
    actual: 'an unresolved $ref',
    message: `The ${side} schema for \`${ctx.fieldName}\` contains a \`$ref\` that could not be resolved.`,
  });
}

/**
 * Distinguish "this `$ref` is broken" from "there is no such field".
 *
 * Resolution failed; this asks whether the schema at the pointer's own root
 * carries a `$ref` that cannot be followed, which is the server's bug rather
 * than the user's.
 */
function hasUnresolvableRef(
  schema: JsonSchema,
  pointer: string,
  root: JsonSchema | undefined,
): boolean {
  if (typeof schema.$ref === 'string' && !resolveRef(schema, root)) return true;
  // Walk as far as the pointer gets, and report a broken `$ref` at the point it
  // stopped rather than blaming the pointer.
  let current: JsonSchema | undefined = normalizeSchema(schema, root);
  for (const token of parsePointer(pointer)) {
    if (!current) return false;
    const next: unknown = current.properties?.[token];
    if (next && typeof next === 'object') {
      const candidate = next as JsonSchema;
      if (typeof candidate.$ref === 'string' && !resolveRef(candidate, root)) return true;
      current = normalizeSchema(candidate, root);
      continue;
    }
    return false;
  }
  return false;
}

function describeSource(ctx: CheckContext): string {
  return ctx.sourceLabel ? `\`${ctx.sourceLabel}\`` : 'the source';
}

function joinPath(path: string, token: string): string {
  return `${path}/${token.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function joinName(parent: string, key: string): string {
  // The root's name is the tool or parameter; below that, dotted paths read best.
  return parent && parent !== 'value' ? `${parent}.${key}` : key;
}

function fieldNameFor(pointer: string, label: string | undefined): string {
  const tokens = parsePointer(pointer);
  const last = tokens[tokens.length - 1];
  if (last) return last;
  return label ?? 'value';
}

function displayPointer(pointer: string): string {
  return pointer === '' ? '(whole value)' : pointer;
}

function typeLabelAt(schema: JsonSchema, pointer: string, root: JsonSchema | undefined): string {
  const resolved = resolvePointer(schema, pointer, root ?? schema);
  return typeLabel(resolved, root);
}

/** Two issues at the same place with the same code say the same thing once. */
function dedupe(issues: CompatibilityIssue[]): CompatibilityIssue[] {
  const seen = new Set<string>();
  const out: CompatibilityIssue[] = [];
  for (const item of issues) {
    const key = `${item.code}|${item.path}|${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
