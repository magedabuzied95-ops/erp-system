import { spawn } from "child_process";
import { existsSync, mkdirSync, openSync } from "fs";
import { resolve } from "path";

const rootDir = process.cwd();
const serverDir = resolve(rootDir, "server");
const backendEntry = resolve(serverDir, "server.js");
const viteEntry = resolve(rootDir, "node_modules", "vite", "bin", "vite.js");
const logDir = resolve(rootDir, "runtime-logs");
mkdirSync(logDir, { recursive: true });
const backendLog = openSync(resolve(logDir, "dev-backend.log"), "a");
const frontendLog = openSync(resolve(logDir, "dev-frontend.log"), "a");

const startDetached = (command, args, cwd, stdioTarget) => {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: ["ignore", stdioTarget, stdioTarget],
    windowsHide: true,
  });
  child.unref();
  return child.pid;
};

if (!existsSync(backendEntry)) {
  throw new Error(`Backend entry not found: ${backendEntry}`);
}

if (!existsSync(viteEntry)) {
  throw new Error(`Vite entry not found: ${viteEntry}`);
}

const backendPid = startDetached(process.execPath, [backendEntry], serverDir, backendLog);
const frontendPid = startDetached(process.execPath, [viteEntry], rootDir, frontendLog);

console.log(`[dev-all] backend pid=${backendPid}`);
console.log(`[dev-all] frontend pid=${frontendPid}`);
console.log(`[dev-all] backend cwd=${serverDir}`);
console.log(`[dev-all] frontend cwd=${rootDir}`);
