import { spawn } from "node:child_process";

function commandFailure(command: string, code: number | null, stdout: string, stderr: string) {
  const suffix = code === null ? "terminated unexpectedly" : `exited ${code}`;
  const detail = (stderr || stdout).trim();
  return new Error(
    detail ? `${command} ${suffix}: ${detail.slice(-1000)}` : `${command} ${suffix}`
  );
}

export function run(command: string, args: string[], capture = false) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", chunk => {
        stdout += chunk;
      });
      child.stderr?.on("data", chunk => {
        stderr += chunk;
      });
    }
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(commandFailure(command, code, stdout, stderr));
    });
  });
}
