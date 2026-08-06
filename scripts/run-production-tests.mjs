import { spawnSync } from "node:child_process";

const commands = [
  [process.execPath, ["--test", "tests/**/*.test.js"]],
  [process.platform === "win32" ? "npm.cmd" : "npm", ["run", "test:ai-inbox"]],
];

let failed = false;
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) failed = true;
}

process.exitCode = failed ? 1 : 0;
