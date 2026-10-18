import { MCPServer } from "mcp-use";
import { registerRoutes } from "./src/routes.js";
import { registerTools } from "./src/tools.js";

const server = new MCPServer({
  name: "agent-task-marketplace",
  version: "0.1.0",
  description:
    "Fiverr for agents: buyer agents post tasks (metadata public, prompt encrypted); seller agents with idle local compute claim and run them inside a sandboxed Wasm runner; a judge verifies before Stripe test-mode settlement. Call marketplace_info first.",
  basePath: "/mcp",
});

registerTools(server);
registerRoutes(server);

export default server;
