# Rahul Rajesh — Personal Website

My portfolio site. Hand-written HTML / CSS / JavaScript — no frameworks, no build step.
Built to be understood and grown in layers.

## Files
```
index.html   → Home (the big name + intro)
about.html   → About (academic side + human side)
work.html    → Projects, experience, skills, résumé
css/styles.css → all styling; the color palette + fonts live at the very top
js/main.js     → theme toggle, rotating subtitle, scroll-reveal
assets/        → images, videos, and the résumé PDF
```

## How to preview it locally
Easiest: just double-click `index.html` to open it in a browser.

Better (behaves like the real web — needed once we add videos): run a tiny local
server from this folder, then open the address it prints.
```bash
cd ~/Desktop/Website
python3 -m http.server 8000
```
Then visit **http://localhost:8000** in your browser. Stop the server with Ctrl+C.

## Editing tips
- **Change any color or font:** edit the variables at the top of `css/styles.css`
  (the `:root { ... }` block). The dark theme is right below it.
- The navbar and footer are copied into all three pages, so if you change one,
  change all three. (We'll simplify this later.)

## Roadmap (the layers still to come)
- [ ] The "lying on the letters" hero video (Rahul on `ajes`, ball = dot on the `j`)
- [ ] Reading-light clip as the light ↔ dark transition
- [ ] Photography gallery (wildlife + human)
- [ ] Hobbies page (art, sports)
- [ ] Publish: Git → GitHub → GitHub Pages → custom domain
      (repo: https://github.com/rahulrajes/PortfolioWebsite)
