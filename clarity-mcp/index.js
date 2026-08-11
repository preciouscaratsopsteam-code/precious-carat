#!/usr/bin/env node
// MCP stdio server wrapping the Microsoft Clarity data export API.
// Token comes from CLARITY_API_TOKEN, loaded from the repo-root .env file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_URL = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

function loadEnvFile() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadEnvFile();

const TOKEN = process.env.CLARITY_API_TOKEN;

const DIMENSIONS = [
  "Browser",
  "Device",
  "Country/Region",
  "OS",
  "Source",
  "Medium",
  "Campaign",
  "Channel",
  "URL",
];

const server = new McpServer({ name: "clarity", version: "1.0.0" });

server.tool(
  "get_live_insights",
  "Fetch Microsoft Clarity analytics for the store (project-live-insights). Returns traffic, engagement time, scroll depth, popular pages, and friction metrics (dead clicks, rage clicks, quickbacks, excessive scrolling, script errors) for the last 1-3 days. Optionally break metrics down by up to three dimensions. NOTE: Clarity allows only 10 API requests per project per day, so batch questions into as few calls as possible.",
  {
    numOfDays: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .default(3)
      .describe("How many days back to include (1, 2, or 3)"),
    dimension1: z.enum(DIMENSIONS).optional().describe("First breakdown dimension"),
    dimension2: z.enum(DIMENSIONS).optional().describe("Second breakdown dimension"),
    dimension3: z.enum(DIMENSIONS).optional().describe("Third breakdown dimension"),
  },
  async ({ numOfDays, dimension1, dimension2, dimension3 }) => {
    if (!TOKEN) {
      return {
        isError: true,
        content: [{ type: "text", text: "CLARITY_API_TOKEN is not set. Add it to the .env file at the repo root." }],
      };
    }

    const url = new URL(API_URL);
    url.searchParams.set("numOfDays", String(numOfDays));
    if (dimension1) url.searchParams.set("dimension1", dimension1);
    if (dimension2) url.searchParams.set("dimension2", dimension2);
    if (dimension3) url.searchParams.set("dimension3", dimension3);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    if (!response.ok) {
      const body = await response.text();
      const hint =
        response.status === 401
          ? " (token invalid or expired — regenerate it in Clarity > Settings > Data Export)"
          : response.status === 429
            ? " (daily limit reached — Clarity allows 10 requests per project per day)"
            : "";
      return {
        isError: true,
        content: [{ type: "text", text: `Clarity API error ${response.status}${hint}: ${body}` }],
      };
    }

    const data = await response.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
