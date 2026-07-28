# Canopy Maps
`by tilusNet Labs`

A slippy-map viewer for stacking multiple semi-transparent raster map layers on
top of each other.

Originally built to visualise the GLA tree data alongside other London basemaps, it is now a generic tool that can visuslise and arbitrary stack of maps. 

Plain HTML/CSS/JS, no build step, no framework.


## Running it

```bash
cp config.example.js config.js   # then add your Mapbox access token
python3 -m http.server 8000
```

Open `http://localhost:8000/`.

## Configuration

Everything about the app is driven by plain config files, so most changes
don't require touching the JS:

- **`layers.json`** — the list of map layers (URL, title, caption, default
  opacity/visibility). Edit this to add, remove, or reorder layers.
- **`config.json`** — app-wide settings: title/description/footer text, the
  default map center/zoom, and search/geolocation parameters.
- **`config.js`** *(git-ignored, not committed)* — holds your Mapbox access
  token, used for the tree-layer tiles and the place-search API. Copy
  `config.example.js` to get started.

## Features

- Per-layer opacity slider, visibility toggle, and drag-to-reorder (stacking
  order) in the side panel.
- Place search (Mapbox Geocoding) and "go to my location" / "follow my
  location" with a live position marker.
- Layer settings and map view persist across refreshes (`localStorage`), with
  a "Reset to defaults" button.
- Shareable permalinks: "Copy link" encodes the current layers + map view
  into a URL.
- Mobile-friendly slide-out panel.

## Files

```
webapp/
  index.html          page shell
  app.js              all app logic
  style.css           layout + styling
  layers.json         layer definitions (human-editable)
  config.json         app settings (title, map defaults, search/geo params)
  config.js           Mapbox token (git-ignored)
  config.example.js   template for config.js
  favicon.svg
```
