#!/usr/bin/env bun
/**
 * CLI Provider Probe — discovers installed agent CLIs, captures help/version output.
 * Does NOT run expensive prompts.
 */

const CLIS = ["claude", "codex", "gemini", "copilot"] as const;

async function which(cmd: string): Promise<string | null> {
  const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) return null;
  return (await new Response(proc.stdout).text()).trim();
}

async function capture(cmd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return (stdout + stderr).trim();
}

async function main() {
  const spikeDir = import.meta.dir;

  for (const cli of CLIS) {
    const path = await which(cli);
    if (!path) {
      console.log(`⏭  ${cli}: not found`);
      continue;
    }

    const version = await capture(cli, ["--version"]);
    console.log(`✓  ${cli} @ ${version} (${path})`);

    const helpArgs = cli === "codex" ? ["--help"] : ["--help"];
    let helpOutput = await capture(cli, helpArgs);

    // Codex: also capture exec --help
    if (cli === "codex") {
      const execHelp = await capture(cli, ["exec", "--help"]);
      helpOutput += "\n\n=== codex exec --help ===\n\n" + execHelp;
    }

    await Bun.write(`${spikeDir}/help-${cli}.txt`, helpOutput);
    console.log(`   → wrote help-${cli}.txt`);
  }

  console.log("\nDone.");
}

main();
