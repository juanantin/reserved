import { buildContext, runCycle } from "./keeper";
import { config } from "./config";
import { logger } from "./logger";

async function main() {
  const runOnce = process.argv.includes("--once");
  const ctx = await buildContext();

  if (runOnce) {
    await runCycle(ctx);
    return;
  }

  logger.info(`Starting keeper loop — polling every ${config.pollIntervalSeconds}s. Ctrl+C to stop.`);
  // Recursive setTimeout, not setInterval — guarantees cycles never overlap even if one
  // takes longer than pollIntervalSeconds (e.g. a slow RPC or a stuck pending tx).
  const loop = async () => {
    try {
      await runCycle(ctx);
    } catch (err) {
      logger.error("Keeper cycle failed:", (err as Error).message);
    }
    setTimeout(loop, config.pollIntervalSeconds * 1000);
  };
  await loop();
}

main().catch((err) => {
  logger.error("Fatal:", err);
  process.exitCode = 1;
});
