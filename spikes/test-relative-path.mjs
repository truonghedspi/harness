#!/usr/bin/env node
// Spike để kiểm tra xem vấn đề có phải từ đường dẫn tương đối tools/review-digest.mjs không

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// Kiểm tra từ thư mục root
console.log("=== Kiểm tra từ thư mục root ===");
console.log("Current working directory:", process.cwd());
console.log("tools/review-digest.mjs exists:", existsSync("tools/review-digest.mjs"));

// Thử chạy từ thư mục root - này sẽ thành công
try {
  console.log("\n=== Chạy từ root - sẽ thành công ===");
  const result = execFileSync("node", ["tools/review-digest.mjs", "--target", ".", "--json"], 
    { encoding: "utf8", maxBuffer: 1e6, cwd: process.cwd() });
  console.log("SUCCESS from root: Command executed without error");
} catch (error) {
  console.log("FAILED from root:", error.message);
}

// Tạo một subprocess chạy từ thư mục loop/ - này sẽ thất bại
console.log("\n=== Chạy từ loop/ - sẽ thất bại ===");
try {
  const result = execFileSync("node", ["tools/review-digest.mjs", "--target", ".", "--json"], 
    { encoding: "utf8", maxBuffer: 1e6, cwd: "loop" });
  console.log("SUCCESS from loop/: Command executed without error");
} catch (error) {
  console.log("FAILED from loop/ (as expected):", error.message);
  console.log("This proves the issue is with relative path");
}

// Thử với đường dẫn tuyệt đối - này sẽ thành công
console.log("\n=== Chạy từ loop/ với đường dẫn tuyệt đối - sẽ thành công ===");
try {
  const result = execFileSync("node", ["../tools/review-digest.mjs", "--target", "..", "--json"], 
    { encoding: "utf8", maxBuffer: 1e6, cwd: "loop" });
  console.log("SUCCESS with relative path: Command executed without error");
} catch (error) {
  console.log("FAILED with relative path:", error.message);
}