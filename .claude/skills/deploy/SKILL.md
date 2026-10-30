---
name: deploy
description: Add a new lecture to the course site and deploy it. The user gives a lecture PDF (a path, or a file they dropped into slides/<course>/); fill its entry in courses.json from the cover, find its video on the course playlist, check the build, show the user a preview of the page, and once they approve it commit and push — the push deploys. Use when the user adds or provides lecture slides, or asks to deploy or publish a lecture.
argument-hint: "[path/to/lecture.pdf]"
---

# Deploy a lecture

The user — the owner or a collaborator with push access — provides the PDF. You fill
`courses.json`, find the video, check the build, preview the page, commit and push: on every push to `main`,
GitHub Actions builds the site and publishes it (`.github/workflows/deploy.yml`); the built
site is never committed. Rules in `CLAUDE.md` apply (PDFs in `slides/` are originals; public
URLs never change).

## 0. Up to date

```bash
git pull --rebase
```

Someone else may have added a lecture since. If uncommitted changes block the pull, name them
and ask.

## 1. The PDF

- **Given a path** outside the repo: copy it (never move) into `slides/<slug>/`, keeping its
  file name — the name becomes a public URL. Never overwrite a PDF already in `slides/`; ask.
- **Nothing given:** the new PDFs are the files in `slides/<slug>/` that no `"pdf"` in
  `courses.json` lists (`git status` shows them as `??`).
- Which course: `ias-lecNN-*.pdf`, or a cover whose second line starts
  `INTRODUCTION TO AUTONOMOUS SYSTEMS` → `intro`; `lecture-NN-*.pdf` (cover without a course
  name) → `engineering`. Unsure → ask.
- **HTML slides, engineering only:** the `.html` of the same name beside the given PDF (Marp
  builds both). Bring it in with `python3 import_slides.py <path/to/lecture-NN-….html> engineering`
  — it cuts the speaker notes; never copy the HTML by hand. None there → the lecture shows no
  Slides link; say so.

## 2. The entry in `courses.json`

Both courses the same way. Read the cover — `pdftotext -f 1 -l 1 <pdf> -`, or Read with
`pages: "1"`. Three lines: `LECTURE N — TITLE`, a second line, `Topics: …`.

**`intro`** — the second line is the course name and the module:

```
LECTURE 6 — STATE ESTIMATION (II)
INTRODUCTION TO AUTONOMOUS SYSTEMS · MODULE III
Topics: Gaussian machinery · Closure theorems · Conjugacy · Kalman filter: predict, update, gain, algorithm
```

**`engineering`** — the second line is the deck's subtitle, or just the course name
(`AUTONOMOUS ROBOTIC SYSTEMS ENGINEERING`, as in Lectures 0–1), which means no `sub`:

```
LECTURE 3 — INSIDE THE DRIVE
FROM A TWIST TO TURNING WHEELS AND SPINNING ROTORS
Topics: Differential drive · Inside the plugin · Odometry · Four wheels · One wheel · Hardware · Rotors
```

Append to that course's `"lectures"`, keys in this order:

```json
{
  "num": 6,
  "title": "State Estimation (II)",
  "sub": "Module III",
  "pdf": "ias-lec06-state-estimation-2-slides.pdf",
  "topics": "Gaussian machinery · Closure theorems · Conjugacy · Kalman filter: predict, update, gain, algorithm"
}
```

- `title`: the cover is all caps — write it in title case like the entries before it.
- `sub`: `intro` → `Module <roman>`. `engineering` → the subtitle in sentence case, names and
  ROS terms capitalised as in earlier entries (`From a Twist to turning wheels and spinning
  rotors`); omitted when the line is the course name.
- `topics`: verbatim — the `Topics:` line is not uppercased (keep the deck's spelling, e.g.
  "Optimisation").
- A cover that does not fit this shape, or casing you cannot be sure of: show the user what
  you read and ask.

## 3. The video

Playlist id = `list=` in the course's `"playlist"`. Its feed lists the videos in playlist order:

```bash
curl -s "https://www.youtube.com/feeds/videos.xml?playlist_id=<playlist id>" | grep -E "<yt:videoId>|<title>"
```

The first `<title>` is the playlist; then one id + title per video. Find the title
`…: Lecture N` and add to the course's `"videos"`:

```json
"6": "https://www.youtube.com/watch?v=<id>&list=<playlist id>&index=<position>"
```

- `index` = the video's position in the feed, from 1. Sanity check: `intro` → N,
  `engineering` → N + 1. If they disagree, ask — do not guess.
- `v=` is required: without it YouTube ignores `index`.
- Not in the feed yet → no video entry; the lecture shows its PDF alone. Say so.
- The feed shows at most 15 videos. Past that, ask the user for the id (YouTube **Share** →
  `youtu.be/<id>`) and confirm its title:
  `curl -s "https://www.youtube.com/oembed?url=https://youtu.be/<id>&format=json"`.
- Also add any earlier lecture's video that is now up but missing from `"videos"`.

## 4. Build and check

```bash
python3 build.py --out /tmp/aig-site
grep -o "<pdf name without .pdf>[^\"]*\|<video id>[^\"]*\|not interactive" /tmp/aig-site/courses/<slug>/index.html | sort -u
```

The lecture count for the course must have gone up, and both the PDF and the video link must be
on the page — for engineering also the `.html` slides, with *not interactive* if they have GIFs or interactive slides. A build failure (`listed in courses.json but no PDF`) means a wrong `"pdf"` name —
fix it and build again: pushed as it is, it would fail the deploy.

## 5. Preview

The build checks the files, not how the entry reads or fits. Before committing, render the
course page from that build — light, dark and 390 px wide — and look at it:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # Linux: google-chrome
PAGE=file:///tmp/aig-site/courses/<slug>/index.html
OUT=/tmp/aig-shots && mkdir -p $OUT
shot() { "$CHROME" --headless=old --hide-scrollbars --virtual-time-budget=5000 "$@" "$PAGE" 2>/dev/null; }
shot --window-size=1280,4000 --screenshot=$OUT/light.png
shot --window-size=1280,4000 --blink-settings=preferredColorScheme=0 --screenshot=$OUT/dark.png
shot --window-size=390,8000 --screenshot=$OUT/phone.png
for f in light dark phone; do magick $OUT/$f.png -define trim:edges=south -trim +repage $OUT/$f.png; done  # cut the empty tail
magick $OUT/phone.png -gravity South -crop 390x1600+0+0 +repage $OUT/phone-end.png  # the last lectures
```

- `--headless=old`: the new mode lays a page out no narrower than 500 px, and the 390 px shot
  cuts off its right edge (`CLAUDE.md`). `preferredColorScheme=0` is dark;
  `--force-dark-mode` leaves the page light. `--virtual-time-budget` waits for the web fonts.
  `trim:edges=south`: a plain `-trim` also cuts the header's top margin, and the logo with it.
- `magick` is ImageMagick. Without it, look at the uncut shots; the whole phone page is shrunk
  past reading — enough for the layout only.

Read `light.png`, `dark.png` and `phone-end.png`, and check:

- the new lecture comes last, with its number, title, sub and topics as on the cover — nothing
  cut off, overlapping or wrapped oddly;
- its buttons in one row, one size: **Slides** (engineering, when imported), **PDF** with its
  size — the red *(not interactive)* under it when the slides have GIFs or interactive slides —
  and **Video** when there is one;
- an `Ongoing` course still ends with *More lectures to come*, then Lecturer and the footer
  (no footer → the window was too short: make it taller);
- dark: all readable; 390 px: nothing runs off the right edge.

Something off → fix it, build and look again.

Then show the user — the push publishes, so they see the page first:

```bash
python3 build.py --serve    # in the background; stop it once they answer
```

Give them `http://localhost:8000/courses/<slug>/` and the shots (`/tmp/aig-shots/light.png`,
`dark.png`, `phone-end.png`), say what you checked, and wait for their OK. Commit and push only
after it — `/deploy` or "publish" does not skip this. A change asked → make it, build, render
and show again.

## 6. Commit and push

The push is the deploy. Push only when the user asked to deploy or publish (`/deploy` counts)
and approved the preview; if they only asked to prepare a lecture, stop here and give them
these commands instead.

```bash
git add slides/<slug>/<new pdf> slides/<slug>/<new html> slides/<slug>/img courses.json
git commit -m "<Course short name>: Lecture N — <title>"
git pull --rebase && git push
gh run list --workflow deploy.yml --limit 1    # this push's Deploy run: wait for ✓, about a minute
```

- Commit only this lecture: the new PDF, its HTML slides and the files they load (`img/`), and `courses.json`. Other uncommitted changes — name them and leave them out.
- Rebase conflict (someone pushed meanwhile): keep both sides in `courses.json`, check that
  `python3 build.py` passes, then `git add courses.json` and `git rebase --continue`.
- Push refused for permission: the user needs collaborator access — the owner adds them under
  **Settings → Collaborators** (or they fork and open a pull request; it deploys when merged).
- The Deploy run failed: its log names the cause — usually a missing PDF; fix it and push again.
  No run for the commit at all: GitHub Actions is off for the repo (README → Hosting).
- Never force-push.

Reply with: the entry (title, sub, topics), the video (id, position) or that there is none yet,
the HTML slides (how many GIFs and scripts) or that there are none, what the preview showed
(and the shots in `/tmp/aig-shots/`), the commit, and the page — live about a minute after the push:
`https://autonomous-intelligence-group.github.io/courses/<slug>/`.
