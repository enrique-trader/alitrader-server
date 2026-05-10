// ─────────────────────────────────────────────────────────────
// AliTrader v2.0 — Servidor completo (API + Dashboard)
// ─────────────────────────────────────────────────────────────

const http  = require('http');
const https = require('https');
const fs    = require('fs');

const PORT       = process.env.PORT || 3001;
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
  if (res.headersSent) return;
  res.writeHead(code, cors());
  res.end(JSON.stringify(obj));
}

function serveDashboard(res) {
  try {
    const html = fs.readFileSync('dashboard.html', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch(e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('dashboard.html no encontrado');
  }
}

async function handleRequest(req, res) {
  const url  = new URL(req.url, `http://localhost:${PORT}`);
  const p    = url.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204, cors()); res.end(); return; }
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${p}`);

  if (p === '/' || p === '/dashboard') { serveDashboard(res); return; }

  if (p === '/health') {
    send(res, 200, { status:'ok', hora: new Date().toLocaleString('es-MX') });
    return;
  }

  try {
    // ── /gold ─────────────────────────────────────────────
    if (p === '/gold') {
      let precio = null, fuente = '';

      // Intento 1: Metals-API gratuita (frankfurter style)
      try {
        const d = await fetchJSON('https://api.frankfurter.app/latest?from=XAU&to=USD');
        if (d.rates && d.rates.USD) {
          precio = Math.round(d.rates.USD * 100) / 100;
          fuente = 'Frankfurter';
        }
      } catch(e) { console.log('Frankfurter falló:', e.message); }

      // Intento 2: Exchange Rate API (XAU/USD gratuita sin límite)
      if (!precio) {
        try {
          const d = await fetchJSON('https://open.er-api.com/v6/latest/XAU');
          if (d.rates && d.rates.USD) {
            precio = Math.round(d.rates.USD * 100) / 100;
            fuente = 'ExchangeRate-API';
          }
        } catch(e) { console.log('ExchangeRate falló:', e.message); }
      }

      // Intento 3: Metals-API pública
      if (!precio) {
        try {
          const d = await fetchJSON('https://metals-api.com/api/latest?access_key=free&base=XAU&symbols=USD');
          if (d.rates && d.rates.USD) {
            precio = Math.round((1 / d.rates.USD) * 100) / 100;
            fuente = 'Metals-API';
          }
        } catch(e) { console.log('Metals-API falló:', e.message); }
      }

      if (!precio) {
        send(res, 500, { error: 'No se pudo obtener precio del oro' });
        return;
      }

      send(res, 200, {
        simbolo:   'XAU/USD',
        precio,
        moneda:    'USD',
        timestamp: Math.floor(Date.now() / 1000),
        fuente,
      });
      return;
    }

    if (p === '/btc') {
      let precio=null, cambio=0, fuente='';
      try {
        const d=await fetchJSON('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT');
        if(d.data&&d.data[0]){ precio=parseFloat(d.data[0].last); const open=parseFloat(d.data[0].sodUtc8); cambio=open>0?Math.round(((precio-open)/open*100)*100)/100:0; fuente='OKX'; }
      } catch(e){ console.log('OKX:',e.message); }
      if(!precio){ try{ const d=await fetchJSON('https://api.diadata.org/v1/assetQuotation/Bitcoin/0x0000000000000000000000000000000000000000'); precio=Math.round(d.Price*100)/100; fuente='DIA'; }catch(e){ console.log('DIA:',e.message); } }
      if(!precio){ try{ const d=await fetchJSON('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'); precio=parseFloat(d.lastPrice); cambio=Math.round(parseFloat(d.priceChangePercent)*100)/100; fuente='Binance'; }catch(e){ console.log('Binance:',e.message); } }
      if(!precio){ send(res,500,{error:'Sin precio BTC'}); return; }
      send(res,200,{simbolo:'BTC/USD',precio:Math.round(precio*100)/100,cambio24h:cambio,moneda:'USD',timestamp:Math.floor(Date.now()/1000),fuente});
      return;
    }

    if (p === '/btc/history') {
      const days=url.searchParams.get('days')||'30';
      try {
        const interval=parseInt(days)<=2?'1H':'1D';
        const limit=Math.min(parseInt(days)<=2?48:parseInt(days),300);
        const d=await fetchJSON(`https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=${interval}&limit=${limit}`);
        if(!d.data||!d.data.length) throw new Error('Sin datos OKX');
        const precios=d.data.reverse().map(k=>({timestamp:parseInt(k[0]),precio:Math.round(parseFloat(k[4])*100)/100}));
        send(res,200,{simbolo:'BTC/USD',dias:parseInt(days),puntos:precios.length,precios,fuente:'OKX'});
      } catch(e) {
        try {
          const interval=parseInt(days)<=2?'1h':'1d';
          const limit=Math.min(parseInt(days)<=2?48:parseInt(days),500);
          const klines=await fetchJSON(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
          const precios=klines.map(k=>({timestamp:k[0],precio:Math.round(parseFloat(k[4])*100)/100}));
          send(res,200,{simbolo:'BTC/USD',dias:parseInt(days),puntos:precios.length,precios,fuente:'Binance'});
        } catch(e2){ send(res,500,{error:'Sin historial BTC',detalle:e2.message}); }
      }
      return;
    }

    send(res,404,{error:'Ruta no encontrada'});

  } catch(err) {
    console.error('Error:',err.message);
    if(!res.headersSent) send(res,500,{error:'Error del servidor',detalle:err.message});
  }
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║    AliTrader v2.0 — Servidor OK      ║');
  console.log(`  ║    Dashboard: http://localhost:${PORT}  ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
server.on('error',(err)=>{ console.error('Error:',err.message); process.exit(1); });
