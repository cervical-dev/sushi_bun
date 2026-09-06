import { tokenize, type Token, type TokenType } from "./lexer.ts";

export type AstNode =
  | StringNode
  | IntegerNode
  | DecimalNode
  | BooleanNode
  | IdentifierNode
  | PathNode
  | BinaryNode
  | UnaryNode
  | FunctionNode;

export interface StringNode { type: "string"; value: string }
export interface IntegerNode { type: "integer"; value: number }
export interface DecimalNode { type: "decimal"; value: number }
export interface BooleanNode { type: "boolean"; value: boolean }
export interface IdentifierNode { type: "identifier"; name: string }
export interface PathNode { type: "path"; parts: AstNode[] }

export interface BinaryNode {
  type: "binary";
  operator: string;
  left: AstNode;
  right: AstNode;
}

export interface UnaryNode {
  type: "unary";
  operator: string;
  operand: AstNode;
}

export interface FunctionNode {
  type: "function";
  name: string;
  target: AstNode;
  arguments: AstNode[];
}

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: "eof", value: "" };
  }

  private advance(): Token {
    const token = this.tokens[this.pos]!;
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(`Expected ${type}, got ${token.type} (${token.value})`);
    }
    return this.advance();
  }

  parse(): AstNode {
    const expr = this.parseImplies();
    if (this.pos < this.tokens.length) {
      const next = this.tokens[this.pos]!;
      throw new Error(`Unexpected trailing token: ${next.type} (${next.value})`);
    }
    return expr;
  }

  private parseImplies(): AstNode {
    let left = this.parseOr();
    while (this.peek().type === "implies") {
      this.advance();
      const right = this.parseOr();
      left = { type: "binary", operator: "implies", left, right };
    }
    return left;
  }

  private parseOr(): AstNode {
    let left = this.parseAnd();
    while (this.peek().type === "or") {
      this.advance();
      const right = this.parseAnd();
      left = { type: "binary", operator: "or", left, right };
    }
    return left;
  }

  private parseAnd(): AstNode {
    let left = this.parseComparison();
    while (this.peek().type === "and") {
      this.advance();
      const right = this.parseComparison();
      left = { type: "binary", operator: "and", left, right };
    }
    return left;
  }

  private parseComparison(): AstNode {
    let left = this.parseAddSub();

    const op = this.peek().type;
    if (
      op === "equal" || op === "not-equal" ||
      op === "greater" || op === "less" ||
      op === "greater-equal" || op === "less-equal"
    ) {
      const token = this.advance();
      const right = this.parseAddSub();
      return { type: "binary", operator: token.value as string, left, right };
    }

    return left;
  }

  private parseAddSub(): AstNode {
    let left = this.parseMulDiv();

    while (this.peek().type === "plus" || this.peek().type === "minus" || this.peek().type === "pipe") {
      const token = this.advance();
      const right = this.parseMulDiv();
      left = { type: "binary", operator: token.value as string, left, right };
    }

    return left;
  }

  private parseMulDiv(): AstNode {
    let left = this.parseUnary();

    while (this.peek().type === "star" || this.peek().type === "slash" || this.peek().type === "div" || this.peek().type === "mod") {
      const token = this.advance();
      const right = this.parseUnary();
      left = { type: "binary", operator: token.value as string, left, right };
    }

    return left;
  }

  private parseUnary(): AstNode {
    if (this.peek().type === "not" || this.peek().type === "minus") {
      const token = this.advance();
      const operand = this.parseUnary();
      return { type: "unary", operator: token.value as string, operand };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): AstNode {
    let node = this.parsePrimary();

    while (true) {
      if (this.peek().type === "is") {
        this.advance();
        const typeName = this.peek();
        if (typeName.type !== "identifier") {
          throw new Error(`Expected type name after 'is', got ${typeName.type}`);
        }
        this.advance();
        const target = node;
        node = { type: "function", name: "is", target, arguments: [{ type: "identifier", name: typeName.value as string }] };
      } else if (this.peek().type === "dot") {
        this.advance();
        if (this.peek().type === "identifier") {
          const name = (this.advance() as Token).value as string;
          if (this.peek().type === "lparen") {
            node = this.parseFunctionCall(node, name);
          } else {
            const newParts = node.type === "path" ? [...node.parts, { type: "identifier", name } as IdentifierNode] : [node, { type: "identifier", name } as IdentifierNode];
            node = { type: "path", parts: newParts };
          }
        } else if (this.peek().type === "lparen") {
          this.advance();
          const args: AstNode[] = [];
          if (this.peek().type !== "rparen") {
            args.push(this.parseImplies());
            while (this.peek().type === "comma") {
              this.advance();
              args.push(this.parseImplies());
            }
          }
          this.expect("rparen");
          node = { type: "function", name: "", target: node, arguments: args };
        }
      } else if (this.peek().type === "lparen" && (node.type === "identifier" || (node.type === "path" && node.parts[node.parts.length - 1]?.type === "identifier"))) {
        const funcName = node.type === "identifier" ? node.name : (node.parts[node.parts.length - 1] as IdentifierNode).name;
        const target = node.type === "identifier" ? { type: "string", value: "" } as AstNode : { type: "path", parts: node.parts.slice(0, -1) } as AstNode;
        node = this.parseFunctionCall(target, funcName);
      } else {
        break;
      }
    }

    return node;
  }

  private parseFunctionCall(target: AstNode, name: string): FunctionNode {
    this.expect("lparen");
    const args: AstNode[] = [];
    if (this.peek().type !== "rparen") {
      args.push(this.parseImplies());
      while (this.peek().type === "comma") {
        this.advance();
        args.push(this.parseImplies());
      }
    }
    this.expect("rparen");
    return { type: "function", name, target, arguments: args };
  }

  private parsePrimary(): AstNode {
    const token = this.peek();

    if (token.type === "string") {
      this.advance();
      return { type: "string", value: token.value as string };
    }

    if (token.type === "integer") {
      this.advance();
      return { type: "integer", value: token.value as number };
    }

    if (token.type === "decimal") {
      this.advance();
      return { type: "decimal", value: token.value as number };
    }

    if (token.type === "boolean") {
      this.advance();
      return { type: "boolean", value: token.value as boolean };
    }

    if (token.type === "identifier") {
      this.advance();
      const name = token.value as string;
      if (name === "$this") {
        return { type: "identifier", name: "$this" };
      }
      return { type: "identifier", name };
    }

    if (token.type === "lparen") {
      this.advance();
      const expr = this.parseImplies();
      this.expect("rparen");
      return expr;
    }

    throw new Error(`Unexpected token: ${token.type} (${token.value})`);
  }
}

export function parse(input: string): AstNode {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  return parser.parse();
}
