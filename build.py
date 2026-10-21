#!/usr/bin/env python3
"""Build the site into docs/: an all-courses page and one page per course.

    python3 build.py                          # -> docs/
    python3 -m http.server 8000 -d docs       # preview at http://localhost:8000/

Everything on the site comes from courses.json; each lecture's PDF is slides/<slug>/<pdf>.
On every push to main, GitHub Actions runs this build and publishes the docs/ it makes
(.github/workflows/deploy.yml); docs/ is not committed. Build locally to check and preview.

    docs/index.html           a redirect to HOME
    docs/courses/             all courses              (templates/courses.html)
    docs/course/<slug>/       one course + its slides/ (templates/course.html)
    docs/logo*.png, style.css                          (assets/)

docs/ is build output only: it is deleted and rebuilt every time, so never keep files there.
"""
import html
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'docs'
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


def main():
    # Every build leaves .nojekyll in OUT; without it, OUT holds files a build did not make.
    if OUT.exists() and not (OUT / '.nojekyll').exists():
        sys.exit(f'{OUT.name}/ was not made by build.py — move its files out, then build again')
    shutil.rmtree(OUT, ignore_errors=True)
    shutil.copytree(HERE / 'assets', OUT)
    (OUT / '.nojekyll').touch()   # marks OUT as made by build.py (checked above)

    missing = []
    groups = {}
    for c in json.loads((HERE / 'courses.json').read_text()):
        page = OUT / 'course' / c['slug']
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

    fill('courses.html', OUT / 'courses' / 'index.html', ROOT='../', FOOTER=FOOTER, COURSES='\n'.join(
        GROUP.format(status=esc(status), live=' live' if status == 'Ongoing' else '', cards='\n'.join(cards))
        for status, cards in groups.items()))
    (OUT / 'index.html').write_text(REDIRECT.format(url=HOME))

    if missing:
        # Fail rather than publish a course with a lecture silently gone.
        sys.exit('listed in courses.json but no PDF:\n  ' + '\n  '.join(missing))
    print(f'{OUT.name}/: {sum(map(len, groups.values()))} courses, / -> {HOME}')


if __name__ == '__main__':
    main()
