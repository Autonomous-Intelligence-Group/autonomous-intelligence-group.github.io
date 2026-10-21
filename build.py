#!/usr/bin/env python3
"""Build the site: an all-courses page and one page per course.

    python3 build.py               # build into a temporary folder to check it, then delete it
    python3 build.py --serve       # the same, and preview it at http://localhost:8000/
    python3 build.py --out _site   # build into _site/ and keep it — what GitHub Actions publishes

Everything on the site comes from courses.json; each lecture's PDF is slides/<slug>/<pdf>.
On every push to main, GitHub Actions builds into _site/ and publishes it
(.github/workflows/deploy.yml). A local build goes to a temporary folder, so the project keeps
each PDF and logo once.

    index.html           a redirect to HOME
    courses/             all courses              (templates/courses.html)
    course/<slug>/       one course + its slides/ (templates/course.html)
    logo*.svg, logo*.png, style.css               (assets/)
    favicon.svg          assets/logo.svg on a white ground

The output folder is build output only: it is deleted and rebuilt every time, so never keep
files there.
"""
import argparse
import functools
import html
import http.server
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Temporary: the bare site URL — the one the Lab 1 READMEs already link — opens the
# engineering course. Set to 'courses/' once the all-courses page should be the front door.
HOME = 'course/engineering/'
esc = html.escape

# The same on every page.
FOOTER = ('<span>Autonomous Intelligence Group</span>'
          ' · <a href="https://kau.org.ua/" target="_blank" rel="noopener">Kyiv Academic University</a>'
          ' · <a href="https://www.imath.kiev.ua/" target="_blank" rel="noopener">Institute of Mathematics NAS of Ukraine</a>')

# GitHub Pages has no server-side redirects: a meta refresh, with a plain link as fallback.
REDIRECT = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Redirecting…</title>
<meta http-equiv="refresh" content="0; url={url}">
<link rel="canonical" href="{url}">
</head>
<body><a href="{url}">Continue</a></body>
</html>
'''

ROW = '''      <li class="lecture">
        <span class="num">{num}</span>
        <div class="body">
          <h3>{name}</h3>{sub}{topics}
        </div>
        <div class="links">
          <a class="link" href="slides/{pdf}" target="_blank" rel="noopener">PDF <span>{size}</span></a>{video}
        </div>
      </li>'''
VIDEO = '\n          <a class="link" href="{url}" target="_blank" rel="noopener">Video <span>↗</span></a>'
BUTTON = '      <a class="btn {cls}" href="{url}" target="_blank" rel="noopener">{label} ↗</a>'
CARD = '''      <article class="card">
        <p class="meta">{eyebrow}</p>
        <h3><a href="../course/{slug}/">{title}</a></h3>
        <p class="tagline">{tagline}</p>
        <div class="actions">
          <a class="btn small solid" href="../course/{slug}/">Course content →</a>{register}
        </div>
      </article>'''
REGISTER = '\n          <a class="text-link" href="{url}" target="_blank" rel="noopener">Register ↗</a>'
# One section per status, in the order courses.json first uses it; "Ongoing" gets the live dot.
GROUP = '''  <section>
    <h2 class="group"><span class="dot{live}"></span>{status} courses</h2>
    <div class="courses">
{cards}
    </div>
  </section>'''


def row(lec, pdf, videos):
    url = videos.get(str(lec['num']))
    return ROW.format(
        num=f'{lec["num"]:02d}',
        name=esc(lec['title']),
        sub=f'\n          <p class="sub">{esc(lec["sub"])}</p>' if lec.get('sub') else '',
        topics=f'\n          <p class="topics">{esc(lec["topics"])}</p>' if lec.get('topics') else '',
        pdf=pdf.name,
        size=f'{pdf.stat().st_size / 1e6:.1f} MB',
        video=VIDEO.format(url=esc(url)) if url else '',
    )


def fill(template, dest, **values):
    text = (HERE / 'templates' / template).read_text()
    for key, value in values.items():
        text = text.replace('{{' + key + '}}', value)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)


def build(out):
    # Every build leaves .nojekyll in out; without it, out holds files a build did not make.
    if out.exists() and not (out / '.nojekyll').exists():
        sys.exit(f'{out} was not made by build.py — move its files out, then build again')
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(HERE / 'assets', out, ignore=shutil.ignore_patterns('.DS_Store'))
    (out / '.nojekyll').touch()   # marks out as made by build.py (checked above)
    # The tab icon keeps a white ground: the bare black mark would vanish in a dark tab bar.
    ground = '<rect width="100%" height="100%" fill="#fff"/>'
    mark = (HERE / 'assets' / 'logo.svg').read_text()
    (out / 'favicon.svg').write_text(re.sub(r'<svg[^>]*>', r'\g<0>' + ground, mark, count=1))

    missing = []
    groups = {}
    for c in json.loads((HERE / 'courses.json').read_text()):
        page = out / 'course' / c['slug']
        (page / 'slides').mkdir(parents=True)
        rows = []
        for lec in sorted(c['lectures'], key=lambda lec: lec['num']):
            pdf = HERE / 'slides' / c['slug'] / lec['pdf']
            if not pdf.exists():
                missing.append(str(pdf.relative_to(HERE)))
                continue
            shutil.copy2(pdf, page / 'slides' / pdf.name)
            rows.append(row(lec, pdf, c.get('videos', {})))

        # Register leads when a course has a form; otherwise the recordings do.
        actions = [BUTTON.format(cls='primary', url=esc(c['register']), label='Register')] if c.get('register') else []
        actions.append(BUTTON.format(cls='ghost' if actions else 'primary', url=esc(c['playlist']), label='Recordings'))
        fill('course.html', page / 'index.html', ROOT='../../', FOOTER=FOOTER,
             TITLE=esc(c['title']), EYEBROW=esc(c['eyebrow']), TAGLINE=esc(c['tagline']),
             ACTIONS='\n'.join(actions), LECTURES='\n'.join(rows))

        groups.setdefault(c['status'], []).append(CARD.format(
            slug=c['slug'], eyebrow=esc(c['eyebrow']), title=esc(c['title']), tagline=esc(c['tagline']),
            register=REGISTER.format(url=esc(c['register'])) if c.get('register') else '',
        ))
        print(f'course/{c["slug"]}/: {len(rows)} lectures')

    fill('courses.html', out / 'courses' / 'index.html', ROOT='../', FOOTER=FOOTER, COURSES='\n'.join(
        GROUP.format(status=esc(status), live=' live' if status == 'Ongoing' else '', cards='\n'.join(cards))
        for status, cards in groups.items()))
    (out / 'index.html').write_text(REDIRECT.format(url=HOME))

    if missing:
        # Fail rather than publish a course with a lecture silently gone.
        sys.exit('listed in courses.json but no PDF:\n  ' + '\n  '.join(missing))
    print(f'{sum(map(len, groups.values()))} courses, / -> {HOME}')


def serve(site, port=8000):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=site)
    with http.server.ThreadingHTTPServer(('localhost', port), handler) as server:
        print(f'http://localhost:{port}/ — Ctrl+C to stop')
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


def main():
    parser = argparse.ArgumentParser(description='Build the site (see the top of build.py).')
    where = parser.add_mutually_exclusive_group()
    where.add_argument('--out', type=Path, help='build into this folder and keep it')
    where.add_argument('--serve', action='store_true', help='preview at http://localhost:8000/')
    args = parser.parse_args()
    if args.out:
        return build(args.out.resolve())
    # A temporary folder, deleted afterwards: no copies of the PDFs and logos in the project.
    with tempfile.TemporaryDirectory() as tmp:
        build(Path(tmp) / 'site')
        if args.serve:
            serve(Path(tmp) / 'site')


if __name__ == '__main__':
    main()
