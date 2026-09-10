# Sar Pay Zone Frontend

Sar Pay Zone is a static multi-page frontend for a Myanmar literature marketplace. The frontend keeps the existing vanilla HTML/CSS/JavaScript architecture and connects to the existing Railway API.

## Design direction

The refreshed interface uses a **premium literary marketplace** direction: forest green for trust and reading culture, warm paper surfaces for a book-like atmosphere, amber as a restrained editorial accent, and Noto Sans Myanmar for reliable Burmese glyph rendering. Product cards use soft elevation, responsive grids, and short motion transitions. The bottom navigation becomes a floating, thumb-friendly control on mobile while the home banner and content grid expand gracefully on wider screens.

## Run locally

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Then open `http://localhost:4173/` or the public sandbox preview URL.

## Notes

The frontend is intentionally kept as a static bundle so it can be deployed to Vercel or served alongside the existing backend. API configuration remains in each page's JavaScript and should be moved to an environment-aware configuration layer in a later engineering pass.
