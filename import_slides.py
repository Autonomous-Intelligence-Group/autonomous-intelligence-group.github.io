#!/usr/bin/env python3
"""Bring a lecture's HTML slides into slides/<course>/, beside its PDF.

    python3 import_slides.py <path/to/lecture-NN-….html> <course slug>

The slides are Marp's HTML export: one file, with its pictures in img/ beside it. The copy
leaves out the speaker notes — the presenter view's, never meant for readers, and this repo
is public — and the pictures it shows go to slides/<course>/img/, each stored once. Run it
again whenever the slides change; build.py then links them next to the PDF.
"""
import shutil
import sys
from pathlib import Path

from build import HERE, pictures

NOTE = '<div class="bespoke-marp-note"'


def without_notes(html):
    """Cut every presenter note: its <div class="bespoke-marp-note"> with all it holds."""
    while (start := html.find(NOTE)) != -1:
        depth, i = 0, start
        while True:
            opening, closing = html.find('<div', i), html.find('</div>', i)
            if opening != -1 and opening < closing:
                depth, i = depth + 1, opening + len('<div')
            else:
                depth, i = depth - 1, closing + len('</div>')
                if depth == 0:
                    break
        html = html[:start] + html[i:]
    return html


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    deck, course = Path(sys.argv[1]).resolve(), sys.argv[2]
    dest = HERE / 'slides' / course
    if not dest.is_dir():
        sys.exit(f'no slides/{course}/ — the course slug is its folder there')
    if not (dest / deck.with_suffix('.pdf').name).exists():
        sys.exit(f'no slides/{course}/{deck.with_suffix(".pdf").name}: the slides show only next to their PDF')

    shown = pictures(deck)
    lost = [name for name in shown if not (deck.parent / name).exists()]
    if lost:
        sys.exit('the slides show pictures that are not there:\n  ' + '\n  '.join(lost))
    for name in shown:
        (dest / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(deck.parent / name, dest / name)
    html = without_notes(deck.read_text())
    (dest / deck.name).write_text(html)

    gifs = sum(name.lower().endswith('.gif') for name in shown)
    print(f'slides/{course}/{deck.name}: {len(shown)} pictures, {gifs} of them GIFs; speaker notes left out')


if __name__ == '__main__':
    main()
