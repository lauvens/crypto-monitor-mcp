const http = require("http");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const PORT = 3000;
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// ── CORS headers for embedded iframe usage ──
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── Fetch crypto market data from CoinGecko ──
async function fetchCryptoMarkets(params = {}) {
  const {
    ids,
    vs_currency = "usd",
    order = "market_cap_desc",
    per_page = 20,
  } = params;

  const queryParams = {
    vs_currency,
    order,
    per_page,
    page: 1,
    sparkline: false,
    price_change_percentage: "24h,7d",
  };

  if (ids) queryParams.ids = ids;

  const { data } = await axios.get(`${COINGECKO_BASE}/coins/markets`, {
    params: queryParams,
  });

  return data.map((coin) => ({
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol,
    current_price: coin.current_price,
    market_cap: coin.market_cap,
    total_volume: coin.total_volume,
    price_change_percentage_24h: coin.price_change_percentage_24h,
    price_change_percentage_7d:
      coin.price_change_percentage_7d_in_currency ?? null,
    image: coin.image,
  }));
}

// ── MCP configuration ──
const mcpConfig = {
  name: "crypto-monitor",
  version: "1.0.0",
  description:
    "Explore and compare crypto assets by price, volume, market cap, and timeframe",
  tools: [
    {
      name: "get_crypto_prices",
      description:
        "Retrieve cryptocurrency market data including prices, market cap, volume, and price changes across timeframes",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "string",
            description:
              'Comma-separated CoinGecko coin IDs (e.g. "bitcoin,ethereum,solana"). Leave empty for top coins.',
          },
          vs_currency: {
            type: "string",
            description: 'Target currency (default: "usd")',
            default: "usd",
          },
          order: {
            type: "string",
            description: "Sort order for the API query",
            enum: [
              "market_cap_desc",
              "market_cap_asc",
              "volume_desc",
              "volume_asc",
            ],
            default: "market_cap_desc",
          },
          per_page: {
            type: "number",
            description: "Number of results (1-100, default 20)",
            default: 20,
          },
        },
      },
    },
  ],
  widget: {
    url: "/widget",
    description: "Interactive cryptocurrency market dashboard",
  },
};

// ── Parse JSON body from POST requests ──
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
  setCors(res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // GET /mcp → MCP configuration
    if (req.method === "GET" && url.pathname === "/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mcpConfig));
    }

    // POST /mcp/tools/get_crypto_prices → Fetch crypto data
    if (
      req.method === "POST" &&
      url.pathname === "/mcp/tools/get_crypto_prices"
    ) {
      const params = await parseBody(req);
      const data = await fetchCryptoMarkets(params);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ result: data }));
    }

    // GET /widget → Serve the HTML widget
    if (req.method === "GET" && url.pathname === "/widget") {
      const widgetPath = path.join(__dirname, "public", "widget.html");
      const html = fs.readFileSync(widgetPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(html);
    }

    // 404 fallback
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    console.error("Server error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Crypto Monitor MCP Server running on http://localhost:${PORT}`);
  console.log(`   MCP config:  http://localhost:${PORT}/mcp`);
  console.log(`   Widget:      http://localhost:${PORT}/widget`);
  console.log(`   Tool:        POST http://localhost:${PORT}/mcp/tools/get_crypto_prices`);
});
