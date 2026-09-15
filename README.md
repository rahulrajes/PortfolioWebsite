# Rahul Rajesh — Personal Website

My portfolio site. Hand-written HTML / CSS / JavaScript. No frameworks, no build step.
Built to be understood and grown in layers.

## Files
```
index.html        → Landing: the "R. Rajesh" loader + hero + bottom dock navigator
academic.html     → Section 01 (placeholder)
journey.html      → Section 02 (placeholder)
blogs.html        → Section 03 (placeholder)
photography.html  → Section 04 (placeholder)
about.html        → Section 05 (placeholder)
css/styles.css    → all styling; the palette + fonts live at the very top (:root)
js/main.js        → theme toggle, preloader counter, dock navigator
assets/           → images, videos, and the résumé PDF
```

## How to preview it locally
Run a tiny local server from this folder, then open the address it prints.
```bash
cd ~/Desktop/Website
python3 -m http.server 8000
```
Then visit **http://localhost:8000** in your browser. Stop the server with Ctrl+C.
(Double-clicking `index.html` also works, but the local server behaves like the
real web, which matters once we add the hero video.)

## How the landing works
1. A preloader shows "R. Rajesh" while a percentage counts to 100.
2. The name glides up into the hero position and the stage is revealed.
3. The bottom dock is the navigation: the arrows cycle the five sections, and the
   spinning circle opens whichever section is showing.

## Editing tips
- **Change any color or font:** edit the variables at the top of `css/styles.css`
  (the `:root { ... }` block). The dark theme is right below it.
- The top bar + footer are copied into each section page, so if you change one,
  change them all. (We'll simplify this later.)

## Roadmap (the layers still to come)
- [ ] The "lying on the letters" hero video (Rahul on the letters, ball = dot on the `j`)
- [ ] Reading-light clip as the light / dark transition
- [ ] Real content poured into each section (Academic reuses the old Work page,
      which is preserved in git history)
- [ ] Publish: Git → GitHub → GitHub Pages → custom domain
      (repo: https://github.com/rahulrajes/PortfolioWebsite)
