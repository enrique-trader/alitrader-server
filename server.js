// ─────────────────────────────────────────────────────────────
// AliTrader v2.0 — Servidor proxy local (corregido)
// ─────────────────────────────────────────────────────────────

const http  = require('http');
const https = require('https');

const PORT       = 3001;
const METALS_KEY = '68071bbcd490047e8dc762dce2135ede';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Error parseando JSON: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function send(res, code, obj) {
  res.writeHead(code, cors());
  res.end(JSON.stringify(obj));
}

async function handleRequest(req, res) {
  const url  = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204, cors()); res.end(); return; }

  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${path}`);

  try {

    // /health
    if (path === '/health') {
      send(res, 200, { status: 'ok', hora: new Date().toLocaleString('es-MX') });
      return;
    }

    // /gold — precio del oro en USD
    if (path === '/gold') {
      const data = await fetchJSON(
        `https://api.metalpriceapi.com/v1/latest?api_key=${METALS_KEY}&base=USD&currencies=XAU`
      );

      if (!data.success) throw new Error(data.error?.info || 'MetalPriceAPI error');

      // base USD → XAU rate = cuánto oro compras con 1 USD
      // precio oro en USD = 1 / rate
      const xauRate = data.rates.XAU;
      const precioUSD = Math.round((1 / xauRate) * 100) / 100;

      send(res, 200, {
        simbolo:   'XAU/USD',
        precio:    precioUSD,
        moneda:    'USD',
        timestamp: data.timestamp,
        fuente:    'MetalPriceAPI',
      });
      return;
    }

    // /btc — precio actual de Bitcoin
    if (path === '/btc') {
      try {
        const data = await fetchJSON(
          'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true'
        );

        if (!data.bitcoin || !data.bitcoin.usd) throw new Error('Respuesta inesperada de CoinGecko');

        const btc = data.bitcoin;
        send(res, 200, {
          simbolo:   'BTC/USD',
          precio:    btc.usd,
          cambio24h: Math.round((btc.usd_24h_change || 0) * 100) / 100,
          moneda:    'USD',
          timestamp: btc.last_updated_at || Math.floor(Date.now()/1000),
          fuente:    'CoinGecko',
        });
      } catch(e) {
        // Fallback: usar API alternativa de Binance (pública, sin key)
        try {
          const ticker = await fetchJSON('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
          send(res, 200, {
            simbolo:   'BTC/USD',
            precio:    parseFloat(ticker.lastPrice),
            cambio24h: Math.round(parseFloat(ticker.priceChangePercent) * 100) / 100,
            moneda:    'USD',
            timestamp: Math.floor(Date.now()/1000),
            fuente:    'Binance',
          });
        } catch(e2) {
          send(res, 500, { error: 'No se pudo obtener precio BTC', detalle: e2.message });
        }
      }
      return;
    }

    // /btc/history — historial de precios BTC
    if (path === '/btc/history') {
      const days     = url.searchParams.get('days') || '30';
      try {
        const interval = parseInt(days) <= 2 ? 'minutely' : 'daily';
        const data = await fetchJSON(
          `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=${interval}`
        );
        if (!data.prices || !Array.isArray(data.prices)) throw new Error('Sin historial');
        const precios = data.prices.map(p => ({
          timestamp: p[0],
          precio:    Math.round(p[1] * 100) / 100,
        }));
        send(res, 200, { simbolo:'BTC/USD', dias:parseInt(days), puntos:precios.length, precios, fuente:'CoinGecko' });
      } catch(e) {
        // Fallback: historial de Binance con klines
        try {
          const interval = parseInt(days) <= 2 ? '1h' : '1d';
          const limit = Math.min(parseInt(days) <= 2 ? 48 : parseInt(days), 500);
          const klines = await fetchJSON(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
          const precios = klines.map(k => ({ timestamp: k[0], precio: Math.round(parseFloat(k[4])*100)/100 }));
          send(res, 200, { simbolo:'BTC/USD', dias:parseInt(days), puntos:precios.length, precios, fuente:'Binance' });
        } catch(e2) {
          send(res, 500, { error: 'No se pudo obtener historial BTC', detalle: e2.message });
        }
      }
      return;
    }

    // 404
    send(res, 404, { error: 'Ruta no encontrada', rutas: ['/health', '/gold', '/btc', '/btc/history?days=30'] });

  } catch (err) {
    console.error('Error:', err.message);
    // Solo enviar error si no se han enviado headers aún
    if (!res.headersSent) {
      send(res, 500, { error: 'Error del servidor', detalle: err.message });
    }
  }
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔════════════════════════════════════════╗');
  console.log('  ║     AliTrader v2.0 — Servidor OK       ║');
  console.log('  ╠════════════════════════════════════════╣');
  console.log(`  ║  Puerto:  http://localhost:${PORT}        ║`);
  console.log('  ║  Rutas:   /gold  /btc  /btc/history    ║');
  console.log('  ╚════════════════════════════════════════╝');
  console.log('');
  console.log('  Servidor corriendo. No cierres esta ventana.');
  console.log('  Para detener: Ctrl + C');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Puerto ${PORT} ocupado. Cierra la otra instancia.\n`);
  } else {
    console.error('Error:', err);
  }
  process.exit(1);
});
