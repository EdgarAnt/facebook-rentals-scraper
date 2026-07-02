# 🏠 Facebook Rentals Scraper

A Node.js bot that scrapes rental listings from Facebook groups and Marketplace using [Playwright](https://playwright.dev/). It opens a real browser, waits for you to log in to Facebook manually, scrolls through posts, filters by price and area, and generates a **web interface (`resultados.html`)** with filterable cards to review the rentals it found.

> 📍 **The listings are focused on the Santa Fe area of Mexico City** (including nearby neighborhoods such as Memetla). You can change the target groups and search area in `config.js` and `main.js`.

---

## ✨ Features

- Scrapes **multiple Facebook groups** at once (configurable).
- Scrapes **Facebook Marketplace** (rental search by area, e.g. "Memetla").
- **Persistent session**: saves your Facebook login in `./fb-session/`, so you don't have to log in every time.
- **Automatic detection** of:
  - Price (`$12,000`, `12 mil`, `12000 pesos/al mes/mensuales`).
  - Property type (Apartment, Room, House, Other).
  - Area / neighborhood.
- **Smart filters**: discards posts from people *looking* for a rental, non-housing services (chair/audio rentals, etc.), and listings over budget.
- Generates an **interactive HTML interface** with filters by price, group, type, and text.

---

## 📋 Prerequisites

- **Node.js** 18 or higher — [download here](https://nodejs.org/)
- **Google Chrome / Chromium** (Playwright installs it automatically)
- A **Facebook** account with access to the groups you want to scrape
- **macOS, Windows, or Linux** (the `open resultados.html` command at the end is macOS-specific; see notes below)

---

## ▶️ Usage

### Step 1 — Set up (first time only)

Open your terminal and run these commands one by one:

```bash
git clone https://github.com/EdgarAnt/facebook-rentals-scraper.git
cd facebook-rentals-scraper
npm install
npx playwright install chromium
```

- `git clone` → downloads the project
- `cd` → enters the folder
- `npm install` → installs the dependencies
- `npx playwright install chromium` → installs the browser the bot uses

### Step 2 — Run the bot

```bash
node main.js
```

When you run it:

1. A visible **Chrome** window opens on Facebook.
2. In the terminal you'll see: *"Inicia sesión en Facebook y cuando estés listo presiona Enter..."* (Log in to Facebook and press Enter when ready).
3. **Log in** to Facebook inside that window (only the first time; afterwards the session is saved).
4. Go back to the terminal and **press Enter**.
5. The bot goes through each group and Marketplace, scrolling and collecting posts.
6. When it finishes, it generates `resultados.html` and **opens it automatically** in your browser.
7. Press Enter again in the terminal to close the browser.

### Step 3 — Configure (optional)

Open `config.js` to tune the search:

| What | How |
|---|---|
| **Groups** to scrape | Edit the `GRUPOS` list (name + URL) |
| **Maximum price** | Change `precio_max: 50000` |
| **Areas / neighborhoods** | Fill in `zonas: []`, e.g. `zonas: ["Santa Fe", "Memetla"]` |
| **How many posts** | Raise or lower `SCROLLS_POR_GRUPO: 20` |

> 💡 Notes:
> - The first run takes longer (it downloads the browser). After that it's fast.
> - The session is saved in `./fb-session/`. **Do not delete that folder** unless you want to log in from scratch again.
> - The auto-open command only works on **macOS**. On Windows/Linux, open `resultados.html` manually in your browser.

---

## ⚙️ Configuration

All parameters live in [`config.js`](./config.js):

```js
export const CONFIG = {
  GRUPOS: [
    { nombre: "Rentas CDMX", url: "https://www.facebook.com/groups/1878242172196712/" },
    { nombre: "Rentas CDMX 2", url: "https://www.facebook.com/share/g/1EAWhbSbdV/" },
  ],
  SCROLLS_POR_GRUPO: 20,   // how many times it scrolls per group (more = more posts)
  FILTROS: {
    precio_max: 50000,     // maximum monthly rent in MXN
    zonas: [],             // areas/neighborhoods to search. Empty = accept any area
  },
};
```

| Parameter | Description |
|---|---|
| `GRUPOS` | List of Facebook groups to scrape (`nombre` + `url`). Add as many as you want. |
| `SCROLLS_POR_GRUPO` | Number of scrolls per group. More scrolls = more posts, but slower. |
| `FILTROS.precio_max` | Maximum monthly rent (MXN). More expensive posts are flagged as "doesn't pass". |
| `FILTROS.zonas` | Array of neighborhoods/areas to filter (e.g. `["Roma", "Condesa"]`). Empty accepts all. |

> The Marketplace search is hardcoded to "Memetla" inside `main.js` (function `scrapeMarketplaceMemetla`). You can change the search term there for another area.

---

## 🧠 How it works

The project is simple, with two main files:

- **`main.js`** — browser automation, DOM extraction, filtering, and HTML generation.
- **`config.js`** — the `CONFIG` object with all tunable parameters.

### Internal flow

1. **Persistent session** — `chromium.launchPersistentContext("./fb-session")` stores cookies and browser state so the login survives across runs.
2. **Post extraction** — it walks the `[role="feed"]` of each group, cleans the text (removes UI buttons, photo URLs, garbled timestamps), and gets the post link while avoiding comment anchors.
3. **Filtering** (`pasaFiltros`) — a post passes if:
   - It contains rental-offer keywords, **and**
   - It's not from someone *looking* for a rental, **and**
   - It's not a non-housing service, **and**
   - Its price is ≤ `precio_max`, **and**
   - It contains an area from `zonas` (if the list is non-empty).
4. **Marketplace** — searches for items under `/marketplace/item/` and adds them labeled "Marketplace Memetla".
5. **Output** — prints a summary to the terminal and generates `resultados.html` with an interface to filter by price, group, property type, and free text.

---

## 📦 Dependencies

| Package | Use |
|---|---|
| [`playwright`](https://www.npmjs.com/package/playwright) | Browser automation (Chromium). |
| [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) | Installed for future use (not used in the current code yet). |

The project uses **ESM modules** (`"type": "module"` in `package.json`), so it uses `import`/`export` syntax.

---

## 📁 Project structure

```
facebook-rentals-scraper/
├── main.js            # Main logic: scraping + filtering + HTML generation
├── config.js          # Configurable parameters
├── resultados.html    # Generated interface (overwritten on every run)
├── img/               # Images used in the interface (cover)
├── fb-session/        # Persistent Facebook session (DO NOT delete / DO NOT commit)
├── package.json
└── README.md
```

---

## 🖥️ OS notes

At the end, the bot runs `open resultados.html` to open the interface, which **only works on macOS**. On other systems:

- **Windows**: change `exec("open resultados.html")` to `exec("start resultados.html")` in `main.js`, or open the file manually.
- **Linux**: use `exec("xdg-open resultados.html")`, or open the file manually.

Either way, you can always open `resultados.html` manually in your browser.

---

## ⚠️ Disclaimer

This project is for personal and educational use. Scraping Facebook may go against its terms of service; use it at your own risk and in moderation.
