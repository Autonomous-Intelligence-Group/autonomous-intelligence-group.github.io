---
name: deploy
description: Add a new lecture to the course site and deploy it. The user gives a lecture PDF (a path, or a file they dropped into slides/<course>/); fill its entry in courses.json from the cover, find its video on the course playlist, build docs/, then commit and push — the push deploys. Use when the user adds or provides lecture slides, or asks to deploy or publish a lecture.
argument-hint: "[path/to/lecture.pdf]"
---

# Deploy a lecture

The user — the owner or a collaborator with push access — provides the PDF. You fill
`courses.json`, find the video, build `docs/`, commit and push: GitHub Pages publishes `docs/`
from `main` on every push (Deploy from a branch: `main`, `/docs`). Rules in `CLAUDE.md` apply
(PDFs in `slides/` are originals; public URLs never change).

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
python3 build.py
grep -o '<pdf name>\|<video id>[^"]*' docs/course/<slug>/index.html | sort -u
```

The lecture count for the course must have gone up, and both the PDF and the video link must be
on the page. A build failure (`listed in courses.json but no PDF`) means a wrong `"pdf"` name —
fix it and build again; `docs/` from a failed build must never be committed.

Only content changed, so no visual check is needed. If templates, `assets/` or `build.py`
changed, render light, dark and 390 px wide first (`CLAUDE.md`).

## 5. Commit and push

The push is the deploy. Push only when the user asked to deploy or publish (`/deploy` counts);
if they only asked to prepare a lecture, stop here and give them these commands instead.

```bash
git add slides/<slug>/<new pdf> courses.json docs
git commit -m "<Course short name>: Lecture N — <title>"
git pull --rebase && git push
```

- Commit only this lecture: the new PDF, `courses.json` and `docs/`. Other uncommitted changes — name them and leave them out.
- Rebase conflict (someone pushed meanwhile): keep both sides in `courses.json`, then
  `python3 build.py`, `git add courses.json docs`, `git rebase --continue`. Never hand-merge
  `docs/` — rebuild it.
- Push refused for permission: the user needs collaborator access — the owner adds them under
  **Settings → Collaborators** (or they fork and open a pull request; it deploys when merged).
- Never force-push.

Reply with: the entry (title, sub, topics), the video (id, position) or that there is none yet,
the commit, and the page — live about a minute after the push:
`https://autonomous-intelligence-group.github.io/course/<slug>/`.
