# 🏠 Bot Rentas CDMX

Bot en Node.js que rastrea publicaciones de renta en grupos de Facebook y en Marketplace (CDMX) usando [Playwright](https://playwright.dev/). Abre un navegador real, espera a que inicies sesión manualmente en Facebook, hace scroll por las publicaciones, filtra por precio y zona, y genera una **interfaz web (`resultados.html`)** con tarjetas filtrables para revisar las rentas encontradas.

---

## ✨ Características

- Rastrea **varios grupos de Facebook** a la vez (configurables).
- Rastrea **Facebook Marketplace** (búsqueda de rentas por zona, ej. "Memetla").
- **Sesión persistente**: guarda tu login de Facebook en `./fb-session/`, así no tienes que iniciar sesión cada vez.
- **Detección automática** de:
  - Precio (`$12,000`, `12 mil`, `12000 pesos/al mes/mensuales`).
  - Tipo de inmueble (Depto, Habitación, Casa, Otro).
  - Zona / colonia.
- **Filtros inteligentes**: descarta posts de gente que *busca* renta, servicios que no son vivienda (renta de sillas, audio, etc.) y publicaciones fuera de presupuesto.
- Genera una **interfaz HTML interactiva** con filtros por precio, grupo, tipo y texto.

---

## 📋 Requisitos previos

- **Node.js** 18 o superior — [descargar aquí](https://nodejs.org/)
- **Google Chrome / Chromium** (Playwright lo instala automáticamente)
- Una cuenta de **Facebook** con acceso a los grupos que quieras rastrear
- **macOS, Windows o Linux** (el comando `open resultados.html` al final es de macOS; ver notas abajo)

---

## 🚀 Instalación

```bash
# 1. Clona el repositorio
git clone https://github.com/TU_USUARIO/bot-rentas-cdmx.git
cd bot-rentas-cdmx

# 2. Instala las dependencias
npm install

# 3. Instala el navegador de Playwright (solo la primera vez)
npx playwright install chromium
```

---

## ▶️ Uso

```bash
node main.js
```

Al ejecutarlo:

1. Se abre una ventana visible de Chrome en Facebook.
2. En la terminal verás: *"Inicia sesión en Facebook y cuando estés listo presiona Enter..."*
3. **Inicia sesión** en Facebook dentro de esa ventana (solo la primera vez; después la sesión se guarda).
4. Regresa a la terminal y **presiona Enter**.
5. El bot navega por cada grupo y por Marketplace, haciendo scroll y recolectando publicaciones.
6. Al terminar se genera `resultados.html` y **se abre automáticamente** en tu navegador.
7. Presiona Enter de nuevo en la terminal para cerrar el navegador.

> 💡 La sesión se guarda en `./fb-session/`. **No borres esa carpeta** a menos que quieras volver a iniciar sesión desde cero.

---

## ⚙️ Configuración

Todos los parámetros están en [`config.js`](./config.js):

```js
export const CONFIG = {
  GRUPOS: [
    { nombre: "Rentas CDMX", url: "https://www.facebook.com/groups/1878242172196712/" },
    { nombre: "Rentas CDMX 2", url: "https://www.facebook.com/share/g/1EAWhbSbdV/" },
  ],
  SCROLLS_POR_GRUPO: 20,   // cuántas veces hace scroll en cada grupo (más = más posts)
  FILTROS: {
    precio_max: 50000,     // renta máxima mensual en MXN
    zonas: [],             // zonas/colonias a buscar. Vacío = acepta cualquier zona
  },
};
```

| Parámetro | Descripción |
|---|---|
| `GRUPOS` | Lista de grupos de Facebook a rastrear (`nombre` + `url`). Puedes agregar los que quieras. |
| `SCROLLS_POR_GRUPO` | Número de scrolls por grupo. Más scrolls = más publicaciones, pero más lento. |
| `FILTROS.precio_max` | Renta mensual máxima (MXN). Los posts más caros se marcan como "no pasa". |
| `FILTROS.zonas` | Array de colonias/zonas a filtrar (ej. `["Roma", "Condesa"]`). Vacío acepta todas. |

> La búsqueda de Marketplace está fijada a "Memetla" dentro de `main.js` (función `scrapeMarketplaceMemetla`). Puedes cambiar el término ahí si quieres otra zona.

---

## 🧠 Cómo funciona

El proyecto es simple, con dos archivos principales:

- **`main.js`** — automatización del navegador, extracción del DOM, filtrado y generación del HTML.
- **`config.js`** — objeto `CONFIG` con todos los parámetros ajustables.

### Flujo interno

1. **Sesión persistente** — `chromium.launchPersistentContext("./fb-session")` guarda cookies y estado del navegador para que el login sobreviva entre ejecuciones.
2. **Extracción de posts** — se recorre el `[role="feed"]` de cada grupo, se limpia el texto (se quitan botones de UI, URLs de fotos, timestamps rotos) y se obtiene el enlace del post evitando anclas de comentarios.
3. **Filtrado** (`pasaFiltros`) — un post pasa si:
   - Contiene palabras de oferta de renta, **y**
   - No es de alguien *buscando* renta, **y**
   - No es un servicio que no es vivienda, **y**
   - Su precio es ≤ `precio_max`, **y**
   - Contiene alguna zona de `zonas` (si la lista no está vacía).
4. **Marketplace** — busca items en `/marketplace/item/` y los agrega con la etiqueta "Marketplace Memetla".
5. **Salida** — se imprime un resumen en la terminal y se genera `resultados.html` con una interfaz que permite filtrar por precio, grupo, tipo de inmueble y texto libre.

---

## 📦 Dependencias

| Paquete | Uso |
|---|---|
| [`playwright`](https://www.npmjs.com/package/playwright) | Automatización del navegador (Chromium). |
| [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) | Instalado para uso futuro (aún no se usa en el código actual). |

El proyecto usa **módulos ESM** (`"type": "module"` en `package.json`), por lo que se usa la sintaxis `import`/`export`.

---

## 📁 Estructura del proyecto

```
bot-rentas-cdmx/
├── main.js            # Lógica principal: scraping + filtrado + generación de HTML
├── config.js          # Parámetros configurables
├── resultados.html    # Interfaz generada (se sobrescribe en cada ejecución)
├── img/               # Imágenes usadas en la interfaz (portada)
├── fb-session/        # Sesión persistente de Facebook (NO borrar / NO subir a git)
├── package.json
└── README.md
```

---

## 🖥️ Notas por sistema operativo

Al final, el bot ejecuta `open resultados.html` para abrir la interfaz, lo cual **solo funciona en macOS**. En otros sistemas:

- **Windows**: cambia `exec("open resultados.html")` por `exec("start resultados.html")` en `main.js`, o abre el archivo manualmente.
- **Linux**: usa `exec("xdg-open resultados.html")`, o abre el archivo manualmente.

En cualquier caso, siempre puedes abrir `resultados.html` a mano en tu navegador.

---

## ⚠️ Aviso

Este proyecto es para uso personal y educativo. El scraping de Facebook puede ir en contra de sus términos de servicio; úsalo bajo tu propia responsabilidad y con moderación.
