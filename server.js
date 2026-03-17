import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { z } from "zod";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const widgetHtml = readFileSync("public/widget.html", "utf8");
const port = Number(process.env.PORT ?? 3000);
const MCP_PATH = "/mcp";

// ── Fetch crypto data from CoinGecko ──
async function fetchCryptoMarkets({ vs_currency = "usd", order = "market_cap_desc", per_page = 20 } = {}) {
  const params = new URLSearchParams({
    vs_currency,
    order,
    per_page: String(per_page),
    page: "1",
    sparkline: "false",
    price_change_percentage: "24h,7d",
  });

  const res = await fetch(`${COINGECKO_BASE}/coins/markets?${params}`);
  if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
  const data = await res.json();

  return data.map((coin) => ({
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol,
    current_price: coin.current_price,
    market_cap: coin.market_cap,
    total_volume: coin.total_volume,
    price_change_percentage_24h: coin.price_change_percentage_24h,
    price_change_percentage_7d: coin.price_change_percentage_7d_in_currency ?? null,
    image: coin.image,
  }));
}

// ── Create MCP server instance ──
function createCryptoServer() {
  const server = new McpServer({
    name: "crypto-monitor",
    version: "1.0.0",
  });

  // Register the widget as an MCP resource
  server.registerResource(
    "crypto-widget",
    "ui://widget/crypto-monitor.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://widget/crypto-monitor.html",
          mimeType: "text/html+skybridge",
          text: widgetHtml,
          _meta: {
            "openai/widgetPrefersBorder": true,
          },
        },
      ],
    })
  );

  // Register the crypto prices tool
  server.registerTool(
    "get_crypto_prices",
    {
      title: "Get Crypto Prices",
      description:
        "Use this when the user wants to explore, compare, or monitor cryptocurrency prices, market caps, volumes, or price changes. Returns top coins from CoinGecko with 24h and 7d change data.",
      inputSchema: {
        vs_currency: z
          .string()
          .default("usd")
          .describe("Target fiat currency (e.g. usd, eur)"),
        order: z
          .enum(["market_cap_desc", "market_cap_asc", "volume_desc", "volume_asc"])
          .default("market_cap_desc")
          .describe("Sort order for API query"),
        per_page: z
          .number()
          .min(1)
          .max(100)
          .default(20)
          .describe("Number of coins to return"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        "openai/outputTemplate": "ui://widget/crypto-monitor.html",
        "openai/toolInvocation/invoking": "Fetching crypto data",
        "openai/toolInvocation/invoked": "Crypto data loaded",
      },
    },
    async (args) => {
      try {
        const coins = await fetchCryptoMarkets({
          vs_currency: args.vs_currency,
          order: args.order,
          per_page: args.per_page,
        });

        return {
          content: [
            {
              type: "text",
              text: `Loaded ${coins.length} cryptocurrencies sorted by ${args.order}.`,
            },
          ],
          structuredContent: {
            coins,
            updated_at: new Date().toISOString(),
          },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error fetching data: ${err.message}` }],
          structuredContent: { coins: [], error: err.message },
        };
      }
    }
  );

  return server;
}

// ── HTTP server ──
const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  // CORS preflight
  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" }).end("Crypto Monitor MCP Server");
    return;
  }

  // MCP endpoint
  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createCryptoServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(`Crypto Monitor MCP server listening on http://localhost:${port}${MCP_PATH}`);
});
