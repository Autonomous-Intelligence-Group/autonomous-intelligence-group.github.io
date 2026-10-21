# AIG course materials

The public site of the Autonomous Intelligence Group courses — lecture slides, recordings,
registration: **https://autonomous-intelligence-group.github.io/**

| URL | Page |
|---|---|
| `/` | **Temporary** redirect to `course/engineering/` (`HOME` in `build.py`; set it to `courses/` to make the all-courses page the front door) |
| `/courses/` | All courses |
| `/course/engineering/` | Autonomous Robotic Systems Engineering |
| `/course/intro/` | Introduction to Autonomous Systems |
| `/logo.png`, `/logo-text.png` | The AIG mark and wordmark — other repos hot-link them, keep the names |

**Deploying is pushing.** On every push to `main`, GitHub Actions runs [`build.py`](build.py),
which writes the site into `docs/`, and publishes it — about a minute. `docs/` is not committed,
so each PDF and logo is stored once, in `slides/` and `assets/`; build locally only to check a
change. Python 3 only, nothing to install.

## Adding a lecture

The same for both courses:

1. **Slides.** Put the PDF in `slides/<course>/` — `slides/engineering/lecture-04-….pdf`,
   `slides/intro/ias-lec07-….pdf`. The file name becomes part of a public URL.
2. **Info.** Add it to that course's `"lectures"` in [`courses.json`](courses.json), copied from
   the PDF's cover. `pdf` is the file name in `slides/<course>/`; `sub` and `topics` are optional.
   ```json
   {
     "num": 6,
     "title": "State Estimation (II)",
     "sub": "Module III",
     "pdf": "ias-lec06-state-estimation-2-slides.pdf",
     "topics": "Kalman filter · …"
   }
   ```
   `sub` is the cover's second line: the module for `intro`, the subtitle for `engineering` —
   left out when that line is only the course name.
3. **Video**, when it is up. Upload it to the course's playlist, at the end. On YouTube:
   **Share** → `https://youtu.be/<id>?si=…` — copy the `<id>`. Add to the course's `"videos"`:
   ```json
   "6": "https://www.youtube.com/watch?v=<id>&list=<playlist id>&index=<position in the playlist>"
   ```
   `intro` starts at Lecture 1, so `index` = N; `engineering` starts at Lecture 0, so `index` =
   N + 1. A link with only `list` and `index` (no `v=`) does not work — YouTube then starts at
   the first video.
4. **Check, commit and push** (or open a pull request — it deploys when merged):
   ```bash
   python3 build.py
   git add slides courses.json
   git commit -m "Intro: Lecture 6 — State Estimation (II)"
   git push
   ```

A lecture without a video shows its PDF alone. If `courses.json` lists a PDF that is not in
`slides/`, the build fails — fix it before pushing: pushed, it fails the deploy, and the site
stays as it was.

## Checking before pushing

```bash
python3 build.py                          # prints the lectures per course
python3 -m http.server 8000 -d docs       # http://localhost:8000/ — Ctrl+C to stop
```

`docs/` is output only — deleted and rebuilt on every build and never committed, so never put
files there.

## Other changes

| What | Where |
|---|---|
| A new course | one more object in `courses.json` — `slug` (its URL), `status` (the heading it goes under; `Ongoing` gets the green dot), `title`, `eyebrow`, `tagline`, `register`, `playlist`, `lectures`, `videos` — and a `slides/<slug>/` folder |
| Form and playlist links | `courses.json` |
| LinkedIn | `templates/courses.html` |
| Footer (same on every page) | `FOOTER` in `build.py` |
| Where `/` goes | `HOME` in `build.py` |
| Look | `assets/style.css` — monochrome, square corners, hard shadows, like the lecture decks |

| Path | What it is |
|---|---|
| `courses.json` | Everything the site shows |
| `slides/<course>/` | The lecture PDFs |
| `templates/` | `courses.html` (all courses) and `course.html` (one course) |
| `assets/` | `style.css` and the logos, copied to the site root |
| `assets/logos/` | `logo` and `logo-text` on a transparent background, as SVG and PNG (4× the original size) |
| `build.py` | Fills the templates → `docs/`. Python 3, standard library only |
| `docs/` | The built site, for the local preview — not committed; never edit by hand |
| `.github/workflows/deploy.yml` | On every push to `main`: runs `build.py` and publishes `docs/` |
| `CLAUDE.md` | Conventions for an AI agent working in this repo |
| `.claude/skills/deploy/` | Claude Code `/deploy <pdf>`: all of "Adding a lecture" — fills `courses.json`, finds the video, builds, commits and pushes |

## Hosting

- **Repo.** `Autonomous-Intelligence-Group/autonomous-intelligence-group.github.io` — a repo
  named `<organization>.github.io` is the organization's own site, served at the root of the
  domain. Renaming it moves the site.
- **Pages.** Settings → Pages → Source: GitHub Actions. Each push to `main` runs the **Deploy**
  workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)): it runs `build.py`
  and publishes the `docs/` it makes. Its runs are in the **Actions** tab; a failed run
  publishes nothing, and the site stays as it was.
- **Actions.** The organization enables GitHub Actions for this repo only: organization
  Settings → Actions → General → Policies → selected repositories. With Actions off, a push
  silently deploys nothing — the site stays at its last deploy.
- **The old address**, `https://olehsamoilenko.github.io/aig-materials/` (until 2026-10-21), is
  served by [`olehsamoilenko/olehsamoilenko.github.io`](https://github.com/olehsamoilenko/olehsamoilenko.github.io):
  every old link redirects to the same path here, and it keeps copies of `logo.png` and
  `logo-text.png`, which the Lab 1 READMEs embed. Keep that repo, and never create one named
  `aig-materials` in that account — it would take the old address over.
