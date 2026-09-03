import type { AstNode, PathNode, FunctionNode, BinaryNode, UnaryNode, IdentifierNode } from "./parser.ts";

type FhirPathValue = unknown | unknown[];

function toBool(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  if (val === false) return false;
  if (val === 0) return false;
  if (val === "") return false;
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

function toArray(val: unknown): unknown[] {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

function flatten(arr: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (const item of arr) {
    if (Array.isArray(item)) {
      result.push(...flatten(item));
    } else {
      result.push(item);
    }
  }
  return result;
}

function resolveProperty(obj: unknown, propName: string): unknown {
  if (obj === undefined || obj === null) return undefined;
  if (typeof obj !== "object") return undefined;
  if (Array.isArray(obj)) {
    return flatten(obj.map(item => resolveProperty(item, propName)));
  }
  return (obj as Record<string, unknown>)[propName];
}

function evaluatePath(parts: AstNode[], context: unknown): unknown {
  let current: unknown = context;

  for (const part of parts) {
    if (part.type === "identifier") {
      if (part.name === "$this") {
        current = context;
      } else {
        current = resolveProperty(current, part.name);
      }
    } else if (part.type === "path") {
      current = evaluatePath(part.parts, current);
    } else {
      current = evaluateNode(part, current);
    }
  }

  return current;
}

function evaluateFunction(node: FunctionNode, context: unknown): unknown {
  const target = node.target.type === "string" && (node.target as any).value === ""
    ? context
    : evaluateNode(node.target, context);

  const targetArr = toArray(target);

  switch (node.name) {
    case "empty":
      return targetArr.length === 0;

    case "exists":
      return targetArr.length > 0;

    case "count":
      return targetArr.length;

    case "first":
      return targetArr[0];

    case "last":
      return targetArr[targetArr.length - 1];

    case "where": {
      if (node.arguments.length === 0) return targetArr;
      const predicate = node.arguments[0]!;
      const results: unknown[] = [];
      for (const item of targetArr) {
        const evalResult = evaluateNode(predicate, item);
        if (toBool(evalResult)) {
          results.push(item);
        }
      }
      return results;
    }

    case "select": {
      if (node.arguments.length === 0) return targetArr;
      const selector = node.arguments[0]!;
      const results: unknown[] = [];
      for (const item of targetArr) {
        const evalResult = evaluateNode(selector, item);
        if (Array.isArray(evalResult)) {
          results.push(...evalResult);
        } else if (evalResult !== undefined) {
          results.push(evalResult);
        }
      }
      return results;
    }

    case "matches": {
      if (node.arguments.length === 0) return false;
      const pattern = evaluateNode(node.arguments[0]!, context);
      if (typeof target === "string" && typeof pattern === "string") {
        try {
          return new RegExp(pattern).test(target);
        } catch {
          return false;
        }
      }
      return false;
    }

    case "contains": {
      if (node.arguments.length === 0) return false;
      const arg = evaluateNode(node.arguments[0]!, context);
      if (typeof target === "string" && typeof arg === "string") {
        return target.includes(arg);
      }
      return false;
    }

    case "startsWith": {
      if (node.arguments.length === 0) return false;
      const arg = evaluateNode(node.arguments[0]!, context);
      if (typeof target === "string" && typeof arg === "string") {
        return target.startsWith(arg);
      }
      return false;
    }

    case "endsWith": {
      if (node.arguments.length === 0) return false;
      const arg = evaluateNode(node.arguments[0]!, context);
      if (typeof target === "string" && typeof arg === "string") {
        return target.endsWith(arg);
      }
      return false;
    }

    case "length": {
      if (typeof target === "string") return target.length;
      if (Array.isArray(target)) return target.length;
      return 0;
    }

    case "substring": {
      if (typeof target !== "string") return undefined;
      const start = node.arguments.length > 0 ? evaluateNode(node.arguments[0]!, context) : 0;
      const length = node.arguments.length > 1 ? evaluateNode(node.arguments[1]!, context) : undefined;
      const s = Number(start);
      const l = length !== undefined ? Number(length) : undefined;
      return l !== undefined ? target.substring(s, s + l) : target.substring(s);
    }

    case "toInteger": {
      if (typeof target === "string") {
        const n = parseInt(target, 10);
        return isNaN(n) ? undefined : n;
      }
      if (typeof target === "number") return Math.trunc(target);
      return undefined;
    }

    case "toDecimal": {
      if (typeof target === "string") {
        const n = parseFloat(target);
        return isNaN(n) ? undefined : n;
      }
      if (typeof target === "number") return target;
      return undefined;
    }

    case "toString": {
      if (target === undefined || target === null) return undefined;
      return String(target);
    }

    case "is": {
      if (node.arguments.length === 0) return false;
      const typeName = node.arguments[0]!;
      if (typeName.type === "identifier") {
        const type = (typeName as IdentifierNode).name;
        switch (type) {
          case "String": return typeof target === "string";
          case "Integer": return typeof target === "number" && Number.isInteger(target);
          case "Decimal": return typeof target === "number";
          case "Boolean": return typeof target === "boolean";
          default: return false;
        }
      }
      return false;
    }

    case "distinct": {
      return [...new Set(targetArr)];
    }

    case "union": {
      const result = [...targetArr];
      for (const arg of node.arguments) {
        const val = evaluateNode(arg, context);
        if (Array.isArray(val)) {
          result.push(...val);
        } else if (val !== undefined) {
          result.push(val);
        }
      }
      return result;
    }

    default:
      return undefined;
  }
}

function evaluateNode(node: AstNode, context: unknown): unknown {
  switch (node.type) {
    case "string":
    case "integer":
    case "decimal":
    case "boolean":
      return node.value;

    case "identifier": {
      if (node.name === "$this") return context;
      return resolveProperty(context, node.name);
    }

    case "path":
      return evaluatePath(node.parts, context);

    case "binary":
      return evaluateBinary(node, context);

    case "unary":
      return evaluateUnary(node, context);

    case "function":
      return evaluateFunction(node, context);

    default:
      return undefined;
  }
}

function evaluateBinary(node: BinaryNode, context: unknown): unknown {
  const left = evaluateNode(node.left, context);

  if (node.operator === "and") {
    const right = evaluateNode(node.right, context);
    return toBool(left) && toBool(right);
  }

  if (node.operator === "or") {
    const right = evaluateNode(node.right, context);
    return toBool(left) || toBool(right);
  }

  if (node.operator === "implies") {
    const right = evaluateNode(node.right, context);
    return !toBool(left) || toBool(right);
  }

  const right = evaluateNode(node.right, context);
  const leftArr = toArray(left);
  const rightArr = toArray(right);

  if (node.operator === "=") {
    if (leftArr.length === 0 && rightArr.length === 0) return true;
    if (leftArr.length === 0 || rightArr.length === 0) return false;
    if (leftArr.length === 1 && rightArr.length === 1) {
      return leftArr[0] === rightArr[0];
    }
    return false;
  }

  if (node.operator === "!=") {
    if (leftArr.length === 0 && rightArr.length === 0) return false;
    if (leftArr.length === 0 || rightArr.length === 0) return true;
    if (leftArr.length === 1 && rightArr.length === 1) {
      return leftArr[0] !== rightArr[0];
    }
    return true;
  }

  if (leftArr.length === 1 && rightArr.length === 1) {
    const l = leftArr[0];
    const r = rightArr[0];

    if (node.operator === ">") return Number(l) > Number(r);
    if (node.operator === "<") return Number(l) < Number(r);
    if (node.operator === ">=") return Number(l) >= Number(r);
    if (node.operator === "<=") return Number(l) <= Number(r);
    if (node.operator === "+") {
      if (typeof l === "string" && typeof r === "string") return l + r;
      return Number(l) + Number(r);
    }
    if (node.operator === "-") return Number(l) - Number(r);
    if (node.operator === "*") return Number(l) * Number(r);
    if (node.operator === "/") return Number(l) / Number(r);
    if (node.operator === "div") return Math.trunc(Number(l) / Number(r));
    if (node.operator === "mod") return Number(l) % Number(r);
  }

  return undefined;
}

function evaluateUnary(node: UnaryNode, context: unknown): unknown {
  const operand = evaluateNode(node.operand, context);

  if (node.operator === "not") {
    return !toBool(operand);
  }

  if (node.operator === "-") {
    return -Number(operand);
  }

  return undefined;
}

export function evaluate(ast: AstNode, resource: Record<string, unknown>): unknown {
  return evaluateNode(ast, resource);
}
