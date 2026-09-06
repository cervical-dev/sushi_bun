export type TokenType =
  | "identifier" | "string" | "integer" | "decimal" | "boolean"
  | "dot" | "comma" | "colon" | "pipe" | "lparen" | "rparen" | "lbracket" | "rbracket"
  | "equal" | "not-equal" | "greater" | "less" | "greater-equal" | "less-equal"
  | "plus" | "minus" | "star" | "slash"
  | "and" | "or" | "not" | "implies" | "div" | "mod" | "is"
  | "newline" | "eof";

export interface Token {
  type: TokenType;
  value: string | number | boolean;
}

const KEYWORDS = new Map<string, TokenType>([
  ["and", "and"],
  ["or", "or"],
  ["not", "not"],
  ["implies", "implies"],
  ["div", "div"],
  ["mod", "mod"],
  ["is", "is"],
  ["true", "boolean"],
  ["false", "boolean"],
]);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < input.length) {
    const ch = input[pos]!;

    if (ch === " " || ch === "\t" || ch === "\r") {
      pos++;
      continue;
    }

    if (ch === "\n") {
      tokens.push({ type: "newline", value: "\n" });
      pos++;
      continue;
    }

    if (ch === "'") {
      const start = pos;
      pos++;
      let str = "";
      while (pos < input.length && input[pos] !== "'") {
        if (input[pos] === "\\" && pos + 1 < input.length) {
          pos++;
          str += input[pos];
        } else {
          str += input[pos];
        }
        pos++;
      }
      if (pos >= input.length) {
        throw new Error(`Unterminated string starting at position ${start}`);
      }
      pos++;
      tokens.push({ type: "string", value: str });
      continue;
    }

    if (ch === "." && pos + 1 < input.length && input[pos + 1]! >= "0" && input[pos + 1]! <= "9") {
      let num = ".";
      pos++;
      while (pos < input.length && input[pos]! >= "0" && input[pos]! <= "9") {
        num += input[pos];
        pos++;
      }
      tokens.push({ type: "decimal", value: parseFloat(num) });
      continue;
    }

    if (ch === ".") {
      tokens.push({ type: "dot", value: "." });
      pos++;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      let num = "";
      while (pos < input.length && input[pos]! >= "0" && input[pos]! <= "9") {
        num += input[pos];
        pos++;
      }
      if (pos < input.length && input[pos] === ".") {
        num += ".";
        pos++;
        while (pos < input.length && input[pos]! >= "0" && input[pos]! <= "9") {
          num += input[pos];
          pos++;
        }
        tokens.push({ type: "decimal", value: parseFloat(num) });
      } else {
        tokens.push({ type: "integer", value: parseInt(num, 10) });
      }
      continue;
    }

    if (ch === "-" && pos + 1 < input.length && input[pos + 1]! >= "0" && input[pos + 1]! <= "9") {
      const prevToken = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
      const isUnaryContext = !prevToken || ["operator", "minus", "plus", "star", "slash", "lparen", "comma", "lbracket", "equal", "not-equal", "greater", "less", "greater-equal", "less-equal", "and", "or", "not", "implies", "div", "mod"].includes(prevToken.type);
      if (isUnaryContext) {
        pos++;
        let num = "-";
        while (pos < input.length && input[pos]! >= "0" && input[pos]! <= "9") {
          num += input[pos];
          pos++;
        }
        if (pos < input.length && input[pos] === ".") {
          num += ".";
          pos++;
          while (pos < input.length && input[pos]! >= "0" && input[pos]! <= "9") {
            num += input[pos];
            pos++;
          }
          tokens.push({ type: "decimal", value: parseFloat(num) });
        } else {
          tokens.push({ type: "integer", value: parseInt(num, 10) });
        }
        continue;
      }
    }

    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
      let ident = "";
      while (
        pos < input.length &&
        ((input[pos]! >= "a" && input[pos]! <= "z") ||
         (input[pos]! >= "A" && input[pos]! <= "Z") ||
         (input[pos]! >= "0" && input[pos]! <= "9") ||
         input[pos] === "_" ||
         input[pos] === "$")
      ) {
        ident += input[pos];
        pos++;
      }

      const keywordType = KEYWORDS.get(ident);
      if (keywordType === "boolean") {
        tokens.push({ type: "boolean", value: ident === "true" });
      } else if (keywordType) {
        tokens.push({ type: keywordType, value: ident });
      } else {
        tokens.push({ type: "identifier", value: ident });
      }
      continue;
    }

    if (ch === "=") {
      tokens.push({ type: "equal", value: "=" });
      pos++;
      continue;
    }

    if (ch === "!" && pos + 1 < input.length && input[pos + 1] === "=") {
      tokens.push({ type: "not-equal", value: "!=" });
      pos += 2;
      continue;
    }

    if (ch === ">" && pos + 1 < input.length && input[pos + 1] === "=") {
      tokens.push({ type: "greater-equal", value: ">=" });
      pos += 2;
      continue;
    }

    if (ch === "<" && pos + 1 < input.length && input[pos + 1] === "=") {
      tokens.push({ type: "less-equal", value: "<=" });
      pos += 2;
      continue;
    }

    if (ch === ">") {
      tokens.push({ type: "greater", value: ">" });
      pos++;
      continue;
    }

    if (ch === "<") {
      tokens.push({ type: "less", value: "<" });
      pos++;
      continue;
    }

    if (ch === "+") {
      tokens.push({ type: "plus", value: "+" });
      pos++;
      continue;
    }

    if (ch === "-") {
      tokens.push({ type: "minus", value: "-" });
      pos++;
      continue;
    }

    if (ch === "*") {
      tokens.push({ type: "star", value: "*" });
      pos++;
      continue;
    }

    if (ch === "/") {
      tokens.push({ type: "slash", value: "/" });
      pos++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen", value: "(" });
      pos++;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: "rparen", value: ")" });
      pos++;
      continue;
    }

    if (ch === "[") {
      tokens.push({ type: "lbracket", value: "[" });
      pos++;
      continue;
    }

    if (ch === "]") {
      tokens.push({ type: "rbracket", value: "]" });
      pos++;
      continue;
    }

    if (ch === ",") {
      tokens.push({ type: "comma", value: "," });
      pos++;
      continue;
    }

    if (ch === ":") {
      tokens.push({ type: "colon", value: ":" });
      pos++;
      continue;
    }

    if (ch === "|") {
      tokens.push({ type: "pipe", value: "|" });
      pos++;
      continue;
    }

    pos++;
  }

  tokens.push({ type: "eof", value: "" });
  return tokens.filter(t => t.type !== "newline" && t.type !== "eof");
}
