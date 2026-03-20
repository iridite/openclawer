#!/usr/bin/env node

const fs = require("fs");

const [file, expr, message = "assertion failed", label = "test"] = process.argv.slice(2);

if (!file || !expr) {
  console.error(`[${label}] usage: assert-json-expr.js <file> <expr> [message] [label]`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(file, "utf8"));
const ok = Function("data", `return (${expr});`)(data);

if (!ok) {
  console.error(`[${label}] ${message}`);
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}
