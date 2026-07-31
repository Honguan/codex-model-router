const TARGET_KEYS = new Set(["model", "model_reasoning_effort"]);

function syntax(message, line) {
  const error = new Error(`config.toml line ${line}: ${message}`);
  error.code = "INVALID_TOML";
  return error;
}

function isNewline(text, index) {
  return text[index] === "\n" || text[index] === "\r";
}

function consumeNewline(text, index) {
  if (text[index] === "\r" && text[index + 1] === "\n") return index + 2;
  return index + 1;
}

function skipComment(text, index) {
  while (index < text.length && !isNewline(text, index)) index += 1;
  return index;
}

function decodeBasicString(raw) {
  let output = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      output += character;
      continue;
    }
    index += 1;
    const escaped = raw[index];
    const simple = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
    if (Object.hasOwn(simple, escaped)) {
      output += simple[escaped];
      continue;
    }
    if (escaped === "u" || escaped === "U") {
      const size = escaped === "u" ? 4 : 8;
      const digits = raw.slice(index + 1, index + 1 + size);
      if (!new RegExp(`^[0-9A-Fa-f]{${size}}$`).test(digits)) return null;
      const codePoint = Number.parseInt(digits, 16);
      try { output += String.fromCodePoint(codePoint); } catch { return null; }
      index += size;
      continue;
    }
    return null;
  }
  return output;
}

export function parseStringValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"""') && value.endsWith('"""') && value.length >= 6) {
    return { kind: "string", value: null, style: "multiline-basic" };
  }
  if (value.startsWith("'''") && value.endsWith("'''") && value.length >= 6) {
    return { kind: "string", value: null, style: "multiline-literal" };
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    const decoded = decodeBasicString(value);
    return decoded === null ? { kind: "invalid-string", value: null } : { kind: "string", value: decoded, style: "basic" };
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return { kind: "string", value: value.slice(1, -1), style: "literal" };
  }
  return { kind: "other", value: null };
}

function parseQuotedKey(raw, quote) {
  if (!raw.endsWith(quote) || raw.length < 2) return null;
  if (quote === "'") return raw.slice(1, -1);
  return decodeBasicString(raw);
}

function parseKey(raw, line) {
  const segments = [];
  let index = 0;
  while (index < raw.length) {
    while (index < raw.length && /[ 	]/.test(raw[index])) index += 1;
    if (index >= raw.length) throw syntax("empty key", line);
    let segment;
    if (raw[index] === '"' || raw[index] === "'") {
      const quote = raw[index];
      const start = index;
      index += 1;
      let escaped = false;
      while (index < raw.length) {
        const character = raw[index];
        if (quote === '"' && character === "\\" && !escaped) {
          escaped = true;
          index += 1;
          continue;
        }
        if (character === quote && !escaped) {
          index += 1;
          break;
        }
        escaped = false;
        index += 1;
      }
      const token = raw.slice(start, index);
      segment = parseQuotedKey(token, quote);
      if (segment === null) throw syntax("invalid quoted key", line);
    } else {
      const start = index;
      while (index < raw.length && /[A-Za-z0-9_-]/.test(raw[index])) index += 1;
      if (start === index) throw syntax("invalid bare key", line);
      segment = raw.slice(start, index);
    }
    segments.push(segment);
    while (index < raw.length && /[ 	]/.test(raw[index])) index += 1;
    if (index >= raw.length) break;
    if (raw[index] !== ".") throw syntax("invalid dotted key", line);
    index += 1;
  }
  return segments;
}

function consumeQuoted(text, index, line, quote, multiline) {
  const delimiter = multiline ? quote.repeat(3) : quote;
  index += delimiter.length;
  while (index < text.length) {
    if (multiline && text.startsWith(delimiter, index)) return index + delimiter.length;
    const character = text[index];
    if (!multiline && character === quote) return index + 1;
    if (!multiline && isNewline(text, index)) throw syntax("newline in single-line string", line);
    if (quote === '"' && character === "\\") {
      const escaped = text[index + 1];
      if (multiline && isNewline(text, index + 1)) {
        index = consumeNewline(text, index + 1);
        line += 1;
        while (index < text.length && (/[ 	]/.test(text[index]) || isNewline(text, index))) {
          if (isNewline(text, index)) { index = consumeNewline(text, index); line += 1; }
          else index += 1;
        }
        continue;
      }
      if (["b", "t", "n", "f", "r", '"', "\\"].includes(escaped)) {
        index += 2;
        continue;
      }
      if (escaped === "u" || escaped === "U") {
        const size = escaped === "u" ? 4 : 8;
        const digits = text.slice(index + 2, index + 2 + size);
        if (!new RegExp(`^[0-9A-Fa-f]{${size}}$`).test(digits)) throw syntax("invalid Unicode escape", line);
        const codePoint = Number.parseInt(digits, 16);
        if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) throw syntax("invalid Unicode scalar", line);
        index += 2 + size;
        continue;
      }
      throw syntax("invalid basic-string escape", line);
    }
    if (isNewline(text, index)) {
      index = consumeNewline(text, index);
      line += 1;
    } else {
      const code = text.charCodeAt(index);
      if (code < 0x20 && character !== "	") throw syntax("control character in string", line);
      index += 1;
    }
  }
  throw syntax("unterminated string", line);
}

function scanValue(text, start, line) {
  let index = start;
  let square = 0;
  let curly = 0;
  let lastSignificant = start - 1;
  let commentStart = null;
  let statementLineEnd = null;

  while (index < text.length) {
    const character = text[index];
    if (character === "#") {
      if (square === 0 && curly === 0 && commentStart === null) commentStart = index;
      index = skipComment(text, index);
      if (square === 0 && curly === 0) {
        statementLineEnd = index;
        break;
      }
      continue;
    }
    if (isNewline(text, index)) {
      if (square === 0 && curly === 0) {
        statementLineEnd = index;
        break;
      }
      index = consumeNewline(text, index);
      line += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      const multiline = text.startsWith(character.repeat(3), index);
      index = consumeQuoted(text, index, line, character, multiline);
      lastSignificant = index - 1;
      continue;
    }
    if (character === "[") square += 1;
    else if (character === "]") {
      square -= 1;
      if (square < 0) throw syntax("unexpected ]", line);
    } else if (character === "{") curly += 1;
    else if (character === "}") {
      curly -= 1;
      if (curly < 0) throw syntax("unexpected }", line);
    }
    if (!/[ 	]/.test(character)) lastSignificant = index;
    index += 1;
  }

  if (square !== 0 || curly !== 0) throw syntax("unterminated array or inline table", line);
  if (lastSignificant < start) throw syntax("missing value", line);
  const lineEnd = statementLineEnd ?? index;
  const statementEnd = lineEnd < text.length ? consumeNewline(text, lineEnd) : lineEnd;
  return {
    valueEnd: lastSignificant + 1,
    commentStart,
    lineEnd,
    statementEnd,
    next: statementEnd
  };
}

function scanHeader(text, start, line) {
  const arrayTable = text.startsWith("[[", start);
  const openingLength = arrayTable ? 2 : 1;
  const closing = arrayTable ? "]]" : "]";
  let index = start + openingLength;
  let quote = null;
  let escaped = false;
  while (index < text.length) {
    const character = text[index];
    if (quote) {
      if (quote === '"' && character === "\\" && !escaped) {
        escaped = true;
        index += 1;
        continue;
      }
      if (character === quote && !escaped) quote = null;
      escaped = false;
      if (isNewline(text, index)) throw syntax("newline in table header", line);
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      index += 1;
      continue;
    }
    if (text.startsWith(closing, index)) break;
    if (isNewline(text, index)) throw syntax("unterminated table header", line);
    index += 1;
  }
  if (index >= text.length) throw syntax("unterminated table header", line);
  const keyRaw = text.slice(start + openingLength, index).trim();
  if (!keyRaw) throw syntax("empty table header", line);
  parseKey(keyRaw, line);
  index += closing.length;
  while (index < text.length && /[ 	]/.test(text[index])) index += 1;
  if (text[index] === "#") index = skipComment(text, index);
  if (index < text.length && !isNewline(text, index)) throw syntax("unexpected content after table header", line);
  const next = index < text.length ? consumeNewline(text, index) : index;
  return { next };
}

function validateValueShape(raw, line) {
  const value = raw.trim();
  if (!value) throw syntax("missing value", line);
  if (value.startsWith("[") || value.startsWith("{")) return;
  if (value.startsWith('"') || value.startsWith("'")) {
    if (parseStringValue(value).kind === "invalid-string") throw syntax("invalid string value", line);
    return;
  }
  const booleanOrSpecial = /^(?:true|false|[+-]?(?:inf|nan))$/;
  const integerOrFloat = /^[+-]?(?:0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*|(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?)$/;
  const dateOrTime = /^(?:\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;
  if (!booleanOrSpecial.test(value) && !integerOrFloat.test(value) && !dateOrTime.test(value)) {
    throw syntax("unsupported or invalid bare value", line);
  }
}

export function scanToml(text) {
  if (text.includes("\0")) throw syntax("NUL byte is not valid TOML", 1);
  const bomLength = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const assignments = [];
  const targets = new Map();
  let firstTableStart = null;
  let currentTable = [];
  let index = bomLength;
  let line = 1;

  while (index < text.length) {
    const physicalLineStart = index;
    while (index < text.length && /[ 	]/.test(text[index])) index += 1;
    if (index >= text.length) break;
    if (isNewline(text, index)) {
      index = consumeNewline(text, index);
      line += 1;
      continue;
    }
    if (text[index] === "#") {
      index = skipComment(text, index);
      if (index < text.length) {
        index = consumeNewline(text, index);
        line += 1;
      }
      continue;
    }
    if (text[index] === "[") {
      if (firstTableStart === null) firstTableStart = physicalLineStart;
      const header = scanHeader(text, index, line);
      currentTable = ["<table>"];
      if (header.next > index && header.next <= text.length && header.next !== text.length) line += 1;
      index = header.next;
      continue;
    }

    const statementLine = line;
    const keyStart = index;
    let quote = null;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (quote) {
        if (quote === '"' && character === "\\" && !escaped) {
          escaped = true;
          index += 1;
          continue;
        }
        if (character === quote && !escaped) quote = null;
        escaped = false;
        if (isNewline(text, index)) throw syntax("newline before =", line);
        index += 1;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        index += 1;
        continue;
      }
      if (character === "=") break;
      if (character === "#" || isNewline(text, index)) throw syntax("missing =", line);
      index += 1;
    }
    if (index >= text.length) throw syntax("missing =", line);
    const keyRaw = text.slice(keyStart, index).trim();
    const keySegments = parseKey(keyRaw, line);
    index += 1;
    while (index < text.length && /[ 	]/.test(text[index])) index += 1;
    const valueStart = index;
    const value = scanValue(text, valueStart, line);
    const rawValue = text.slice(valueStart, value.valueEnd);
    validateValueShape(rawValue, statementLine);
    const assignment = {
      keySegments,
      table: currentTable,
      line: statementLine,
      lineStart: physicalLineStart,
      valueStart,
      valueEnd: value.valueEnd,
      rawValue,
      parsedValue: parseStringValue(rawValue),
      commentStart: value.commentStart,
      lineEnd: value.lineEnd,
      statementEnd: value.statementEnd
    };
    assignments.push(assignment);
    if (currentTable.length === 0 && keySegments.length === 1 && TARGET_KEYS.has(keySegments[0])) {
      if (targets.has(keySegments[0])) throw syntax(`duplicate top-level ${keySegments[0]}`, statementLine);
      targets.set(keySegments[0], assignment);
    }
    line += (text.slice(valueStart, value.next).match(/\r\n|\r|\n/g) || []).length;
    index = value.next;
  }

  return {
    assignments,
    targets,
    bomLength,
    newline,
    firstTableStart: firstTableStart ?? text.length
  };
}

export function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let lastStart = text.length + 1;
  let output = text;
  for (const edit of sorted) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > text.length) throw new Error("invalid text edit");
    if (edit.end > lastStart) throw new Error("overlapping text edits");
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    lastStart = edit.start;
  }
  return output;
}

export function insertionEdit(text, scan, additions) {
  if (!additions.length) return null;
  const at = scan.firstTableStart;
  const before = text.slice(0, at);
  const newline = scan.newline;
  const needsLeadingNewline = before.length > scan.bomLength && !before.endsWith("\n") && !before.endsWith("\r");
  const block = `${needsLeadingNewline ? newline : ""}${additions.join(newline)}${newline}`;
  return { start: at, end: at, text: block };
}

export function removalEdit(assignment) {
  if (assignment.commentStart !== null) {
    return { start: assignment.lineStart, end: assignment.commentStart, text: "" };
  }
  return { start: assignment.lineStart, end: assignment.statementEnd, text: "" };
}
