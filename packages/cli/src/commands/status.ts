import { defineCommand } from "citty";
export default defineCommand({
  meta: { name: "status", description: "Show AFK session status" },
  run() {
    console.log("afk status — not yet implemented");
  },
});
