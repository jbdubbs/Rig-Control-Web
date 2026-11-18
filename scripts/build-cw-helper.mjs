import { execSync } from "child_process";
import { platform } from "os";
import { mkdirSync } from "fs";

const pl = platform();

if (pl === "linux") {
  console.log("Building cw-key-helper for Linux (static)...");
  execSync("gcc -O2 -o bin/linux/cw-key-helper cw-key-helper.c", { stdio: "inherit" });
  execSync("chmod +x bin/linux/cw-key-helper", { stdio: "inherit" });
} else if (pl === "darwin") {
  console.log("Building cw-key-helper for macOS...");
  execSync("clang -O2 -o bin/mac/cw-key-helper cw-key-helper.c", { stdio: "inherit" });
  execSync("chmod +x bin/mac/cw-key-helper", { stdio: "inherit" });
} else if (pl === "win32") {
  console.log("Building cw-key-helper for Windows...");
  mkdirSync("build", { recursive: true });
  execSync("cl cw-key-helper.c /Fe:bin\\windows\\cw-key-helper.exe /Fo:build\\cw-key-helper.obj /O2 /nologo", { stdio: "inherit" });
} else {
  console.error(`Unsupported platform: ${pl}`);
  process.exit(1);
}

console.log("Done.");
