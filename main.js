import { chromium } from "playwright";
import readline from "readline";
import { writeFileSync } from "fs";
import { exec } from "child_process";
import { CONFIG } from "./config.js";


process.on("SIGINT", () => {
  console.log("\n\n Cerrando...");
  process.exit(0);
});

function extraerPrecio(texto) {
  // Check "X mil" / "$X mil" first so "$19 mil" → 19000, not 19
  const milMatch = texto.match(/\$?\s*(\d[\d,.]*)\s*mil/i);
  if (milMatch) return Math.round(parseFloat(milMatch[1].replace(/,/g, "")) * 1000);
  const pesoMatch = texto.match(/\$\s*([\d,]+)/);
  if (pesoMatch) return parseInt(pesoMatch[1].replace(/,/g, ""));
  const mesMatch = texto.match(/\b(\d[\d,]*)\s*(pesos|mxn|al\s+mes|mensuales)/i);
  if (mesMatch) return parseInt(mesMatch[1].replace(/,/g, ""));
  return null;
}

function detectarTipo(texto) {
  const t = texto.toLowerCase();
  if (/\b(habitaci[oó]n|cuarto|rec[aá]mara|suite|roomie|room\b)/.test(t)) return "Habitación";
  if (/\b(casa\b|caba[ñn]a|residencia\b)/.test(t)) return "Casa";
  if (/\b(departamento|depto|depa\b|loft|estudio|penthouse|\bph\b|apartment)/.test(t)) return "Depto";
  return "Otro";
}

function extraerColonia(texto) {
  return CONFIG.FILTROS.zonas.find(z =>
    texto.toLowerCase().includes(z.toLowerCase())
  ) || null;
}

const PALABRAS_RENTA = [
  "renta", "rento", "rentar", "se renta", "en renta",
  "departamento", "depto", "cuarto", "recamara", "recamara",
  "habitacion", "estudio", "casa compartida", "cuarto compartido",
  "inmueble", "se arrienda", "amueblado", "apartment", "room for rent",
];

function esRenta(texto) {
  const t = texto.toLowerCase();
  return PALABRAS_RENTA.some(p => t.includes(p));
}

function buscaRenta(texto) {
  const t = texto.toLowerCase();
  if (!(/\b(busco|buscamos|buscando|busca|necesito|solicito)\b/.test(t))) return false;
  if (!(/\b(renta|rentar|arrendar|cuarto|departamento|depto|habitaci.n|rec.mara)\b/.test(t))) return false;
  // Posts with explicit offer language are landlord posts, not searchers
  if (/\bse\s+renta\b|\brento\b|\bdisponible\s+en\s+renta\b|\ben\s+renta\s+en\b/.test(t)) return false;
  return true;
}

function esServicioNoVivienda(texto) {
  return /renta\s+de\s+(?:equipo|audio|video|sillas|mesas|sal.n|inflable)/i.test(texto);
}

function pasaFiltros(texto, precio, colonia) {
  if (!esRenta(texto)) return false;
  if (buscaRenta(texto)) return false;
  if (esServicioNoVivienda(texto)) return false;
  if (precio && precio > CONFIG.FILTROS.precio_max) return false;
  if (CONFIG.FILTROS.zonas.length > 0 && !colonia) return false;
  return true;
}

async function esperarEnter(mensaje) {
  console.log(mensaje);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question("", resolve));
  rl.close();
}

async function extraerPosts(page, groupId) {
  return page.evaluate((groupId) => {
    const BOTONES_UI = new Set([
      "Facebook", "Me gusta", "Like", "Comentar", "Comment",
      "Compartir", "Share", "Responder", "Reply", "Ver mas", "See more",
      "Enviar", "Send", "Message", "Mensaje",
    ]);

    const feed = document.querySelector('[role="feed"]');
    if (!feed) return { error: "No se encontro [role='feed']", posts: [], feedHijos: 0 };

    const posts = [];
    const vistosUrls = new Set();

    [...feed.children].forEach((hijo) => {
      // innerText sobre el elemento vivo respeta visibilidad CSS y da texto real
      // (textContent en clones borraba el post principal si era role="article")
      const textoRaw = hijo.innerText?.trim() || "";
      if (textoRaw.length < 100) return;

      // Buscar la ULTIMA ocurrencia de "Shared with Public group"
      // (posts compartidos tienen dos ocurrencias — nos quedamos con lo que sigue de la ultima)
      const patronHeader = /Shared\s+with\s+(?:Public\s+group|Public)|Compartido\s+con\s+(?:Grupo\s+p.blico|grupo\s+p.blico)|posted\s+to|public\s+group/gi;
      let ultimoMatch = null, mh;
      while ((mh = patronHeader.exec(textoRaw)) !== null) ultimoMatch = mh;

      let textoPost = ultimoMatch
        ? textoRaw.substring(ultimoMatch.index + ultimoMatch[0].length).trim()
        : textoRaw;

      // Truncar donde termina el contenido real del post
      const truncaIdx = textoPost.search(
        /[…\.]{0,3}\s*See\s+more|Write\s+a\s+public\s+comment|Write\s+something|Escribe\s+algo|Escribe\s+un\s+comentario|View\s+more\s+comments|View\s+all\s+\d+\s+repl/i
      );
      if (truncaIdx >= 0) textoPost = textoPost.substring(0, truncaIdx).trim();

      // Limpiar ruido residual
      const texto = textoPost
        .replace(/(Facebook\s*){2,}/gi, " ")
        .replace(/\b(?:Top|Rising|All-star|New)\s+(?:contributor|member)\b/gi, "")
        .replace(/\bFollow\b/g, "")
        .replace(/\+\d+[A-Za-z0-9.]{3,}/g, "")       // +137N7oP.com de fotos
        .replace(/\b[A-Za-z0-9]{4,8}\.[a-z]{2,3}\b/g, "") // URLs cortas de fotos: 0hiJH.com
        .replace(/\b(?=[A-Za-z0-9]*[0-9])(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{20,}\b/g, "") // timestamps garbled
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 3 && !BOTONES_UI.has(l))
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim();

      // Descartar posts que empiezan con URL de foto o son muy cortos
      if (texto.length < 20 || /^[A-Za-z0-9]{5,}\.com/.test(texto)) return;

      // URL del post: preferir link sin comment_id
      let url = null;
      const linkLimpio = [...hijo.querySelectorAll('a[href*="/posts/"]')]
        .find(a => !a.href.includes("comment_id"));
      if (linkLimpio) {
        url = linkLimpio.href.split("?")[0];
      } else {
        const linkCom = hijo.querySelector('a[href*="/posts/"]');
        if (linkCom) {
          url = linkCom.href.split("?")[0];
        } else {
          const linkMulti = hijo.querySelector('a[href*="multi_permalinks"]');
          if (linkMulti) {
            const m = linkMulti.href.match(/multi_permalinks=(\d+)/);
            if (m) url = `https://www.facebook.com/groups/${groupId}/posts/${m[1]}/`;
          }
        }
      }

      if (url && vistosUrls.has(url)) return;
      if (url) vistosUrls.add(url);

      posts.push({ texto: texto.substring(0, 900), url, largo: texto.length, grupo: "" });
    });

    return { error: null, posts, feedHijos: feed.children.length };
  }, groupId);
}

function generarHTML({ timestamp, grupos, totalPosts, posts }) {
  const totalRentas = posts.filter(p => p.pasa_filtros).length;
  const fecha = new Date(timestamp).toLocaleString("es-MX");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bot Rentas CDMX</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; color: #333; }

    #portada { position: fixed; inset: 0; background: white; display: flex; align-items: center; justify-content: center; z-index: 999; cursor: pointer; transition: opacity .4s ease; }
    #portada img { width: 320px; height: 320px; object-fit: contain; }
    #portada.oculta { opacity: 0; pointer-events: none; }
    #app { opacity: 0; transition: opacity .4s ease; }
    #app.visible { opacity: 1; }

    header { background: #1a1a2e; color: white; padding: 20px 24px; }
    header h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 4px; }
    .stats { font-size: 0.85rem; opacity: 0.65; }

    #memetla-section { background: linear-gradient(135deg, #1b3a2a 0%, #2a5940 100%); padding: 16px 24px 20px; border-bottom: 3px solid #22c55e; }
    .memetla-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .memetla-title { font-size: 1.05rem; font-weight: 700; color: #fff; }
    .memetla-cnt { background: rgba(255,255,255,.15); color: #d1fae5; padding: 2px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
    #memetla-grid { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent; }
    #memetla-grid::-webkit-scrollbar { height: 4px; }
    #memetla-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,.2); border-radius: 4px; }
    #memetla-grid .card { min-width: 270px; max-width: 300px; flex-shrink: 0; }

    .filters { background: white; padding: 14px 24px; border-bottom: 1px solid #e0e0e0; display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
    .fg { display: flex; flex-direction: column; gap: 4px; }
    .fg label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #999; letter-spacing: .05em; }
    .fg input[type="number"] { width: 110px; padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 0.9rem; }
    .fg input[type="text"] { width: 220px; padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 0.9rem; }
    .grupos-checks { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .grupos-checks label { display: flex; align-items: center; gap: 5px; font-size: 0.85rem; cursor: pointer; }
    .count { margin-left: auto; font-size: 0.85rem; color: #888; align-self: center; white-space: nowrap; }

    #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; padding: 20px 24px; }

    .card { background: white; border-radius: 10px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.07); display: flex; flex-direction: column; gap: 10px; }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .badge { font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 20px; white-space: nowrap; }
    .precio { font-size: 1.25rem; font-weight: 700; color: #166534; white-space: nowrap; }
    .sin-precio { font-size: 0.82rem; color: #bbb; font-weight: 400; }
    .texto { font-size: 0.84rem; color: #555; line-height: 1.55; flex: 1; }
    .card-footer { margin-top: 4px; }
    .btn-fb { display: inline-block; padding: 7px 13px; background: #1877f2; color: white; border-radius: 6px; text-decoration: none; font-size: 0.78rem; font-weight: 600; }
    .btn-fb:hover { background: #166fe5; }
    .sin-url { font-size: 0.75rem; color: #ccc; }
    .empty { grid-column: 1/-1; text-align: center; padding: 60px 20px; color: #bbb; font-size: 1rem; }

    .b0 { background: #dbeafe; color: #1e40af; }
    .b1 { background: #dcfce7; color: #166534; }
    .b2 { background: #fef3c7; color: #92400e; }
    .b3 { background: #fce7f3; color: #9d174d; }
    .b4 { background: #ede9fe; color: #5b21b6; }
    .b-mp { background: #fff7ed; color: #c2410c; }

    .tipo-badge { font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 20px; }
    .tipo-Depto       { background: #e0f2fe; color: #0369a1; }
    .tipo-Habitación  { background: #fdf4ff; color: #7e22ce; }
    .tipo-Casa        { background: #fef9c3; color: #854d0e; }
    .tipo-Otro        { background: #f1f5f9; color: #64748b; }

    .pills { display: flex; gap: 6px; flex-wrap: wrap; }
    .pill { padding: 5px 12px; border-radius: 20px; border: 1.5px solid #ddd; background: white; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: all .15s; color: #555; }
    .pill.active { border-color: #1a1a2e; background: #1a1a2e; color: white; }
  </style>
</head>
<body>
  <div id="portada" onclick="this.classList.add('oculta'); document.getElementById('app').classList.add('visible')">
    <img src="img/Takopi.webp" alt="portada">
  </div>

  <div id="app">
  <header>
    <h1>Bot Rentas CDMX</h1>
    <p class="stats">${totalRentas} rentas &middot; ${totalPosts} posts revisados &middot; ${grupos.length} grupos &middot; ${fecha}</p>
  </header>

  <div id="memetla-section">
    <div class="memetla-header">
      <span class="memetla-title">Memetla</span>
      <span class="memetla-cnt" id="memetla-cnt"></span>
    </div>
    <div id="memetla-grid"></div>
  </div>

  <div class="filters">
    <div class="fg">
      <label>Precio mín</label>
      <input type="number" id="f-min" placeholder="0" step="1000">
    </div>
    <div class="fg">
      <label>Precio máx</label>
      <input type="number" id="f-max" placeholder="Sin límite" step="1000">
    </div>
    <div class="fg">
      <label>Grupos</label>
      <div class="grupos-checks" id="grupos-checks"></div>
    </div>
    <div class="fg">
      <label>Tipo</label>
      <div class="pills" id="tipo-pills">
        <button class="pill active" data-tipo="Depto">Depto</button>
        <button class="pill active" data-tipo="Habitación">Habitación</button>
        <button class="pill active" data-tipo="Casa">Casa</button>
        <button class="pill active" data-tipo="Otro">Otro</button>
      </div>
    </div>
    <div class="fg">
      <label>Buscar</label>
      <input type="text" id="f-texto" placeholder="zona, colonia, palabra...">
    </div>
    <span class="count" id="count"></span>
  </div>

  <div id="grid"></div>
  </div>

  <script>
    const DATA = ${JSON.stringify({ timestamp, grupos, totalPosts, posts })};

    const COLORS = {};
    DATA.grupos.forEach((g, i) => COLORS[g] = i % 5);

    function cardHTML(p, maxLen) {
      const isMP = (p.fuente || 'grupo') === 'marketplace';
      const badgeCls = isMP ? 'badge b-mp' : ('badge b' + (COLORS[p.grupo] ?? 0));
      const badgeLabel = isMP ? 'Marketplace' : p.grupo;
      const precio = p.precio
        ? '<span class="precio">$' + p.precio.toLocaleString('es-MX') + '</span>'
        : '<span class="precio sin-precio">Sin precio</span>';
      const link = p.url
        ? '<a class="btn-fb" href="' + p.url + '" target="_blank">Ver en Facebook →</a>'
        : '<span class="sin-url">Sin enlace</span>';
      const texto = p.texto.replace(/^\\S+\\s+/, '').substring(0, maxLen);
      return '<div class="card">' +
        '<div class="card-top"><span class="' + badgeCls + '">' + badgeLabel + '</span>' + precio + '</div>' +
        '<div style="display:flex;gap:6px;margin-top:-4px"><span class="tipo-badge tipo-' + p.tipo + '">' + p.tipo + '</span></div>' +
        '<p class="texto">' + texto + (p.texto.length > maxLen ? '…' : '') + '</p>' +
        '<div class="card-footer">' + link + '</div>' +
        '</div>';
    }

    function renderMemetla() {
      const posts = DATA.posts.filter(p => /memetla/i.test(p.texto));
      document.getElementById('memetla-cnt').textContent = posts.length + ' resultado' + (posts.length !== 1 ? 's' : '');
      const grid = document.getElementById('memetla-grid');
      if (!posts.length) {
        grid.innerHTML = '<p style="color:rgba(255,255,255,.5);padding:8px 0;font-size:.85rem">Sin resultados de Memetla todavía.</p>';
        return;
      }
      grid.innerHTML = posts.map(p => cardHTML(p, 160)).join('');
    }

    function render(posts) {
      const grid = document.getElementById('grid');
      const rentas = posts.filter(p => p.pasa_filtros);
      document.getElementById('count').textContent = rentas.length + ' rentas';

      if (rentas.length === 0) {
        grid.innerHTML = '<p class="empty">Ninguna renta coincide con los filtros.</p>';
        return;
      }

      grid.innerHTML = rentas.map(p => cardHTML(p, 200)).join('');
    }

    function filtrar() {
      const min = parseInt(document.getElementById('f-min').value) || 0;
      const max = parseInt(document.getElementById('f-max').value) || Infinity;
      const txt = document.getElementById('f-texto').value.toLowerCase();
      const activos = new Set([...document.querySelectorAll('#grupos-checks input:checked')].map(e => e.value));
      const tiposActivos = new Set([...document.querySelectorAll('#tipo-pills .pill.active')].map(e => e.dataset.tipo));

      render(DATA.posts.map(p => ({
        ...p,
        pasa_filtros: p.pasa_filtros
          && activos.has(p.grupo)
          && tiposActivos.has(p.tipo)
          && (p.precio === null || (p.precio >= min && p.precio <= max))
          && (txt === '' || p.texto.toLowerCase().includes(txt))
      })));
    }

    // Init grupos checkboxes
    document.getElementById('grupos-checks').innerHTML = DATA.grupos.map((g, i) => {
      const cls = g.toLowerCase().includes('marketplace') ? 'badge b-mp' : ('badge b' + (i % 5));
      return '<label><input type="checkbox" value="' + g + '" checked> <span class="' + cls + '">' + g + '</span></label>';
    }).join('');

    ['f-min', 'f-max', 'f-texto'].forEach(id =>
      document.getElementById(id).addEventListener('input', filtrar)
    );
    document.getElementById('grupos-checks').addEventListener('change', filtrar);
    document.getElementById('tipo-pills').addEventListener('click', e => {
      const pill = e.target.closest('.pill');
      if (pill) { pill.classList.toggle('active'); filtrar(); }
    });

    renderMemetla();
    render(DATA.posts);
  </script>
</body>
</html>`;
}

async function scrapeGrupo(page, grupo) {
  console.log(`\nNavegando a: ${grupo.nombre}...`);
  await page.goto(grupo.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2000);

  // Leer URL resuelta (los links /share/g/ redirigen al ID numérico real)
  const urlResuelta = page.url();
  const groupId = urlResuelta.match(/\d{10,}/)?.[0];

  const acumulados = new Map();
  const TOTAL_SCROLLS = CONFIG.SCROLLS_POR_GRUPO;

  console.log(`Haciendo scroll en "${grupo.nombre}" (${TOTAL_SCROLLS} scrolls)...`);
  for (let i = 0; i < TOTAL_SCROLLS; i++) {
    await page.evaluate(() => window.scrollBy(0, 3000));
    await page.waitForTimeout(1800);

    const { posts: visibles, feedHijos } = await extraerPosts(page, groupId);
    let nuevos = 0;
    (visibles || []).forEach(p => {
      p.grupo = grupo.nombre;
      const key = p.url || p.texto.substring(0, 80);
      if (!acumulados.has(key)) { acumulados.set(key, p); nuevos++; }
    });

    process.stdout.write(
      `\r  Scroll ${i + 1}/${TOTAL_SCROLLS} -- feed: ${feedHijos ?? "?"} hijos | acumulados: ${acumulados.size} (+${nuevos} nuevos)   `
    );
  }
  console.log("\n");

  return [...acumulados.values()];
}

async function scrapeMarketplaceMemetla(page) {
  const url = "https://www.facebook.com/marketplace/cdmx/propertiesrentals?query=memetla&exact=false";
  console.log("\nNavegando a Marketplace - Memetla...");
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(6000);
  } catch (e) {
    console.log("  Error cargando Marketplace:", e.message);
    return [];
  }

  const acumulados = new Map();
  const SCROLLS = 12;

  console.log(`Haciendo scroll en Marketplace Memetla (${SCROLLS} scrolls)...`);
  for (let i = 0; i < SCROLLS; i++) {
    await page.evaluate(() => window.scrollBy(0, 2500));
    await page.waitForTimeout(2200);

    const items = await page.evaluate(() => {
      const visto = new Set();
      const results = [];
      document.querySelectorAll('a[href*="/marketplace/item/"]').forEach(link => {
        const href = link.href.split("?")[0];
        if (!href || visto.has(href)) return;
        visto.add(href);
        const container = link.closest("[aria-label]") || link.closest("[data-testid]") || link;
        const raw = (container.innerText || link.innerText || "").trim();
        if (raw.length < 8) return;
        results.push({ url: href, texto: raw.substring(0, 600), largo: raw.length });
      });
      return results;
    });

    items.forEach(item => {
      if (!acumulados.has(item.url)) {
        acumulados.set(item.url, { ...item, grupo: "Marketplace Memetla", fuente: "marketplace" });
      }
    });

    process.stdout.write(
      `\r  Scroll ${i + 1}/${SCROLLS} -- marketplace: ${acumulados.size} items   `
    );
  }
  console.log("\n");
  return [...acumulados.values()];
}

async function main() {
  console.log("Abriendo browser...\n");

  const browser = await chromium.launchPersistentContext("./fb-session", { headless: false });
  const page = await browser.newPage();

  console.log("Abriendo Facebook...\n");
  await page.goto(CONFIG.GRUPOS[0].url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await esperarEnter("Inicia sesion en Facebook y cuando estes listo presiona Enter...\n");

  const todosPosts = [];
  for (const grupo of CONFIG.GRUPOS) {
    const posts = await scrapeGrupo(page, grupo);
    console.log(`Posts acumulados de "${grupo.nombre}": ${posts.length}`);
    todosPosts.push(...posts);
  }

  const marketplacePosts = await scrapeMarketplaceMemetla(page);
  console.log(`Posts de Marketplace Memetla: ${marketplacePosts.length}`);
  todosPosts.push(...marketplacePosts);

  const posts = todosPosts;

  console.log(`\nTotal posts de todos los grupos: ${posts.length}\n`);

  if (posts.length === 0) {
    console.log("No se encontraron posts. Asegurate de estar en 'Publicaciones' del grupo.\n");
    await esperarEnter("Presiona Enter para cerrar el browser...");
    await browser.close();
    return;
  }

  console.log("=".repeat(60));
  console.log("REVISANDO POSTS UNO A UNO:\n");

  posts.forEach((post, i) => {
    const precio = extraerPrecio(post.texto);
    const colonia = extraerColonia(post.texto);
    const pasa = pasaFiltros(post.texto, precio, colonia);

    console.log(`[${i + 1}/${posts.length}] ${pasa ? "PASA" : "No pasa"} | largo: ${post.largo}`);
    console.log(`  Grupo: ${post.grupo}`);
    console.log(`  Precio: ${precio ? "$" + precio.toLocaleString() : "no detectado"}`);
    console.log(`  Colonia: ${colonia || "no detectada"}`);
    console.log(`  URL: ${post.url ?? "sin URL"}`);
    console.log(`  Texto: "${post.texto.substring(0, 200).replace(/\n/g, " ")}"`);
    console.log();
  });

  const encontrados = posts.filter(p =>
    pasaFiltros(p.texto, extraerPrecio(p.texto), extraerColonia(p.texto))
  );

  console.log("=".repeat(60));
  console.log("RENTAS QUE PASAN EL FILTRO:\n");

  if (encontrados.length === 0) {
    console.log("Ningun post paso los filtros.");
    console.log(`  precio_max: $${CONFIG.FILTROS.precio_max.toLocaleString()}`);
    console.log(`  zonas: ${CONFIG.FILTROS.zonas.length > 0 ? CONFIG.FILTROS.zonas.join(", ") : "cualquiera"}\n`);
  } else {
    encontrados.forEach((post, i) => {
      const precio = extraerPrecio(post.texto);
      const colonia = extraerColonia(post.texto);
      console.log(`[${i + 1}] RENTA ENCONTRADA`);
      console.log(`  Grupo: ${post.grupo}`);
      console.log(`  Precio: ${precio ? "$" + precio.toLocaleString() : "No especificado"}`);
      console.log(`  Colonia: ${colonia || "No especificada"}`);
      console.log(`  URL: ${post.url ?? "sin URL"}`);
      console.log(`  Texto: ${post.texto.substring(0, 300).replace(/\n/g, " ")}`);
      console.log("-".repeat(50));
    });
  }

  console.log(`\nTotal encontradas: ${encontrados.length} de ${posts.length} posts revisados\n`);

  const postsConDatos = posts.map(p => {
    const precio = extraerPrecio(p.texto);
    const colonia = extraerColonia(p.texto);
    const fuente = p.fuente || "grupo";
    const pasa = fuente === "marketplace"
      ? esRenta(p.texto) && !(precio && precio > CONFIG.FILTROS.precio_max)
      : pasaFiltros(p.texto, precio, colonia);
    return { grupo: p.grupo, precio, colonia, tipo: detectarTipo(p.texto), url: p.url || null, texto: p.texto, fuente, pasa_filtros: pasa };
  });

  const gruposUnicos = [...new Set(postsConDatos.map(p => p.grupo))];
  const html = generarHTML({
    timestamp: new Date().toISOString(),
    grupos: gruposUnicos,
    totalPosts: posts.length,
    posts: postsConDatos,
  });

  writeFileSync("./resultados.html", html, "utf-8");
  console.log("Interfaz guardada → abriendo resultados.html...\n");
  exec("open resultados.html");

  await esperarEnter("Presiona Enter para cerrar el browser...");
  await browser.close();
}

main().catch(console.error);
