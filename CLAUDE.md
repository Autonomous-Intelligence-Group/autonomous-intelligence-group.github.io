# CLAUDE.md — aig-materials

The public site of the Autonomous Intelligence Group courses: https://autonomous-intelligence-group.github.io/.
Readers are students and applicants. How to add a lecture, preview and deploy is in
[README.md](README.md) — read it first; this file is what an agent must also keep in mind.

## Layout and flow

`courses.json` (everything shown) + `slides/<slug>/*.pdf` + `templates/` + `assets/` →
`build.py` → the site → GitHub Pages. On every push to `main`, GitHub Actions
(`.github/workflows/deploy.yml`) runs `build.py --out _site` and publishes `_site/`; the org
enables Actions for this repo only — keep it so (README → Hosting). The built site is never
committed and a local build goes to a temporary folder, so every file is stored once, in its
source folder. Python 3, standard library only.

| URL | Page |
|---|---|
| `/` | Temporary redirect (`HOME` in `build.py`) to `course/engineering/` — Lab 1 READMEs link the bare URL. Later: `courses/` |
| `/courses/` | All courses |
| `/course/engineering/` | Autonomous Robotic Systems Engineering |
| `/course/intro/` | Introduction to Autonomous Systems |
| `/logo.svg`, `/logo-text.svg`, `/logo.png`, `/logo-text.png` | The logos, transparent (PNG at 4×), each stored once in `assets/` — other repos may embed them: never rename or move |

URLs are public and linked from elsewhere: do not rename slugs or paths without asking. The old
address `olehsamoilenko.github.io/aig-materials/` (until 2026-10-21) still works through the repo
`olehsamoilenko/olehsamoilenko.github.io`: it redirects old links to the same path here and keeps
copies of the old logos (PNG on a white ground) — the Lab 1 READMEs, the template and the
students' copies, embed `logo-text.png` from there.

Adding a lecture: the `deploy` skill (`.claude/skills/deploy/`) — fill, build, commit and push
(the push deploys).

## Rules

- **English**, short. Never link the private deck repo or its wiki from the site — readers do not have them.
- **PDFs in `slides/` are originals.** Never delete, move or overwrite them without asking.
  Only build output is disposable — the temporary folder, or the one given to `--out`; a
  script must never clear any other folder (a build once wiped the only copies of five PDFs).
  `build.py` refuses to clear a folder without its `.nojekyll`.
- **Both courses work the same way:** a PDF in `slides/<slug>/`, its entry in `courses.json`
  written from the cover, its video added when it is up. No course is synced or generated
  from elsewhere.
- **Video links** are `watch?v=<id>&list=<playlist>&index=<position>`. `v=` is required: without
  it YouTube ignores `index` and starts at the first video (checked 2026-10-08). `engineering`
  starts at Lecture 0 (`index` = N + 1), `intro` at Lecture 1 (`index` = N). Before adding,
  confirm id and order from the playlist feed —
  `https://www.youtube.com/feeds/videos.xml?playlist_id=<id>` lists ids and titles in order —
  or a video's title via `https://www.youtube.com/oembed?url=https://youtu.be/<id>&format=json`.
- **The build fails on a listed PDF that is missing** — keep it that way: on GitHub a failed
  build publishes nothing, so the live site stays at the last good build.

## Design (decided with the owner — keep unless asked)

- The look of the lecture decks: monochrome, Rajdhani / DM Sans / Space Mono, square corners,
  hard offset shadows, dark cover-style header. The **only colour** is the green dot of
  "Ongoing courses". Light and dark mode both.
- `/courses/`: large AIG wordmark + LinkedIn button; no page title; courses grouped under
  "<status> courses"; each card: eyebrow, title, tagline, **Course content →** button,
  **Register ↗** as a text link. No "latest lecture" line.
- Eyebrow is "Master's course" for both — no university name in it.
- Course page: **← All courses**, Register (button) + Recordings, then lectures — each with
  **PDF** (size measured by the build) and **Video**.
- Footer on every page (`FOOTER` in `build.py`): logo · Autonomous Intelligence Group ·
  Kyiv Academic University (kau.org.ua) · Institute of Mathematics NAS of Ukraine
  (imath.kiev.ua). No year.
- Before pushing a visual change, render it — light, dark and 390 px wide — and look:
  ```bash
  python3 build.py --serve    # http://localhost:8000/ — or headless Chrome --screenshot on it
  ```

Commit messages in English.
