import { Portix } from "@portixone/sdk";

// Mock mode: zero setup, no runtime, no printer. Switch to a real print by
// removing `mode` (or setting it to "runtime") once the Portix Runtime is
// running: https://github.com/portixhq/portixone/tree/master/runtime
const portix = new Portix({ mode: "mock" });

// 32 columns is a safe default for a narrow (58mm) thermal printer — the
// most common width. Adjust WIDTH if printing on an 80mm printer (42-48).
const WIDTH = 32;

function line(char = "-") {
  return char.repeat(WIDTH);
}

function center(text) {
  const padding = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return " ".repeat(padding) + text;
}

function itemRow(name, qty, unitPrice) {
  const left = `${qty}x ${name}`;
  const right = `$${(qty * unitPrice).toFixed(2)}`;
  const gap = Math.max(1, WIDTH - left.length - right.length);
  return left + " ".repeat(gap) + right;
}

function totalRow(label, amount) {
  const right = `$${amount.toFixed(2)}`;
  const gap = Math.max(1, WIDTH - label.length - right.length);
  return label + " ".repeat(gap) + right;
}

const items = [
  { name: "Espresso", qty: 2, price: 3.0 },
  { name: "Croissant", qty: 1, price: 4.5 },
  { name: "Orange Juice", qty: 1, price: 3.5 },
];

const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
const tax = subtotal * 0.08;
const total = subtotal + tax;

const receipt = [
  center("PORTIX CAFE"),
  center("123 Main St, Springfield"),
  new Date().toLocaleString(),
  line(),
  ...items.map((item) => itemRow(item.name, item.qty, item.price)),
  line(),
  totalRow("Subtotal", subtotal),
  totalRow("Tax (8%)", tax),
  totalRow("TOTAL", total),
  line("="),
  center("Thank you for visiting!"),
].join("\n");

await portix.connect();

const result = await portix.print({ content: receipt, copies: 1 });

console.log("print() result:", { jobId: result.jobId, status: result.status });
