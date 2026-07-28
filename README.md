# Canopy Maps
`by tilusNet Labs`

A slippy-map viewer for stacking multiple semi-transparent raster map layers on
top of each other.

Originally built to visualise the GLA tree data alongside other London basemaps, it is now a generic tool that can visualise an arbitrary stack of maps.

Plain HTML/CSS/JS, no build step, no framework.

## Why

To ease rapid data layer visualisations on a map.

Typical use case:

* you've got map layers or geodata loaded into map layers, and
* you want to quickly see them and share them online.

## What you need

All you need are the URLs of the map layers you want visualised:

* For **base maps** search for "tile servers" or "raster tile providers" online, many are free or can be used with a free account. Start [here](https://wiki.openstreetmap.org/wiki/Raster_tile_providers).
* For **data layers** you can use a tile provider like [Mapbox](https://www.mapbox.com/).

## Features

- Per-layer opacity slider, visibility toggle, and drag-to-reorder (stacking
  order) in the side panel.
- Place search (Mapbox Geocoding) and "go to my location" / "follow my
  location" with a live position marker.
- Shareable permalinks: "Copy link" encodes the current layers + map view
  into a URL.
- Layer settings and map view persist across refreshes.
- Mobile-friendly slide-out panel.

## Running it

```bash
cp config.example.js config.js   # then add your Mapbox access token
cp config.example.json config.json
cp layers.example.json layers.json
python3 -m http.server 8000
```

Open `http://localhost:8000/`.

## Configuration

Everything about the app is driven by plain config files, so most changes
don't require touching the JS:

- **`layers.json`** — the list of map layers (URL, title, caption, default
  opacity/visibility). Edit this to add, remove, or reorder layers.
- **`config.json`** — app-wide settings (see table below). Any field left out
  falls back to the built-in default in `app.js`.
- **`config.js`** *(git-ignored, not committed)* — holds your Mapbox access
  token, used for the tree-layer tiles and the place-search API. Copy
  `config.example.js` to get started.

### `config.json` fields

| Field | Description |
| --- | --- |
| `appTitle` | Browser tab title and the heading shown in the side panel. |
| `appDescription` | Subtitle shown under the app title in the side panel. |
| `map.center` | `[lat, lng]` the map opens at on first visit (before any saved view exists). |
| `map.defaultZoom` | Zoom level used with `map.center` on first visit. The larger the value, the more you zoom in. Typical values 1-22. |
| `map.locateZoom` | Zoom level snapped to when the user taps "go to my location". |
| `search.bbox` | `minLon,minLat,maxLon,maxLat` box that biases/restricts place-search results. |
| `search.debounceMs` | Delay after typing stops before a search request fires. |
| `search.minQueryLength` | Minimum characters typed before search results are requested. |
| `search.resultLimit` | Maximum number of place-search results shown. |
| `geolocation.timeoutMs` | How long to wait for a geolocation fix before giving up. |
| `geolocation.watchMaxAgeMs` | Maximum age of a cached position accepted while following live location. |

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
