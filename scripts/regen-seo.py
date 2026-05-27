#!/usr/bin/env python3
"""
Regenerate sitemap.xml and llms-full.txt from the current state of the repo.

Run this whenever you:
- Add a new HTML page (top-level or in a subdirectory)
- Add a new blog post under /blog/
- Rewrite the body of an existing page (so llms-full.txt reflects the new copy)
- Want to refresh <lastmod> dates after content edits

Does NOT touch llms.txt — that one is hand-curated marketing copy with one-line
descriptions per page. The script will flag pages on disk that aren't yet linked
in llms.txt so you know what to add by hand.

Usage:
    python3 scripts/regen-seo.py            # regenerate both files
    python3 scripts/regen-seo.py --check    # exit non-zero if files are stale (CI use)

Idempotent. Re-runs cleanly. Uses git log for <lastmod> when available, falls back
to filesystem mtime otherwise.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://www.ctoondemand.co.uk"

# Page list. Order = sitemap order. (url_path, file_path, changefreq, priority)
# When you add a new page, add it here.
PAGES: list[tuple[str, str, str, str]] = [
    ("/",                                              "index.html",                                            "weekly",  "1.0"),
    ("/method/",                                       "method/index.html",                                     "monthly", "0.9"),
    ("/services/",                                     "services/index.html",                                   "monthly", "0.9"),
    ("/ai-brain/",                                     "ai-brain/index.html",                                   "monthly", "0.9"),
    ("/course/",                                       "course/index.html",                                     "monthly", "0.9"),
    ("/book/",                                         "book/index.html",                                       "monthly", "0.95"),
    ("/about/",                                        "about/index.html",                                      "monthly", "0.8"),
    ("/blog/",                                         "blog/index.html",                                       "weekly",  "0.8"),
]

BLOG_DIR = ROOT / "blog"
BLOG_INDEX = "blog/index.html"


def git_lastmod(path: str) -> str:
    """Return YYYY-MM-DD of last git commit touching this file, falling back to mtime."""
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%cI", "--", path],
            cwd=ROOT, stderr=subprocess.DEVNULL,
        ).decode().strip()
        if out:
            return out.split("T")[0]
    except subprocess.CalledProcessError:
        pass
    ts = os.path.getmtime(ROOT / path)
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def discover_blog_posts() -> list[tuple[str, str, str, str]]:
    """Return blog post entries in priority order. Sorted alphabetically for stability."""
    posts = []
    for p in sorted(BLOG_DIR.glob("*.html")):
        rel = p.relative_to(ROOT).as_posix()
        if rel == BLOG_INDEX:
            continue
        url = "/" + rel
        # Default priority for blog posts: 0.7, "coming-soon" gets 0.6
        prio = "0.6" if "coming-soon" in p.name else "0.7"
        posts.append((url, rel, "monthly", prio))
    return posts


def build_sitemap(entries: list[tuple[str, str, str, str]]) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, file, freq, prio in entries:
        if not (ROOT / file).exists():
            print(f"  skip missing: {file}", file=sys.stderr)
            continue
        lm = git_lastmod(file)
        lines += [
            "  <url>",
            f"    <loc>{SITE}{url}</loc>",
            f"    <lastmod>{lm}</lastmod>",
            f"    <changefreq>{freq}</changefreq>",
            f"    <priority>{prio}</priority>",
            "  </url>",
        ]
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


class MainExtract(HTMLParser):
    """Extract text from <main>, skipping nav/header/footer/script/style/forms."""
    SKIP = {"script", "style", "svg", "noscript",
            "site-topbar", "site-header", "header", "nav", "footer",
            "form", "button"}

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.skip_depth = 0
        self.in_main = False

    def handle_starttag(self, tag, attrs):
        if tag == "main":
            self.in_main = True
        if tag in self.SKIP:
            self.skip_depth += 1
        if self.in_main and self.skip_depth == 0 and tag in ("p", "h1", "h2", "h3", "li", "section", "article", "div"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip_depth > 0:
            self.skip_depth -= 1
        if tag == "main":
            self.in_main = False
        if self.in_main and self.skip_depth == 0 and tag in ("h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_data(self, data):
        if self.in_main and self.skip_depth == 0:
            self.parts.append(data)


def extract_main(path: Path) -> str:
    parser = MainExtract()
    parser.feed(path.read_text())
    text = "".join(parser.parts)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def page_title(path: Path) -> str:
    s = path.read_text()
    m = re.search(r"<title>(.*?)</title>", s, re.S)
    t = (m.group(1) if m else "").strip()
    t = re.sub(r"\s*\|\s*CTO on Demand.*$", "", t)
    # decode common HTML entities
    import html as _html
    return _html.unescape(t)


def build_llms_full(top_pages: list[tuple[str, str, str, str]], blog_posts: list[tuple[str, str, str, str]]) -> str:
    # Headings for the top pages (drop blog index — it gets its own section header below)
    titled = [
        ("Home — CTO on Demand",     "index.html"),
        ("About Nick Tong",           "about/index.html"),
        ("The Partner CTO Method",    "method/index.html"),
        ("Services and Pricing",      "services/index.html"),
        ("AI Brain",                  "ai-brain/index.html"),
        ("Book a Call",               "book/index.html"),
    ]
    out: list[str] = []
    out.append("# CTO on Demand — Full Content for LLM Grounding\n")
    out.append("> All key page content from ctoondemand.co.uk, concatenated for AI assistants.\n")
    out.append(f"> Source: {SITE}/  |  Index: {SITE}/llms.txt\n")
    out.append("---\n")
    for title, file in titled:
        p = ROOT / file
        if not p.exists():
            continue
        out.append(f"\n# {title}\nURL: {SITE}/{'' if file == 'index.html' else file.replace('index.html', '')}\n")
        out.append(extract_main(p))
        out.append("\n---\n")
    out.append("\n# Blog posts\n")
    for url, file, _, _ in blog_posts:
        p = ROOT / file
        if not p.exists():
            continue
        out.append(f"\n## {page_title(p)}\nURL: {SITE}{url}\n")
        out.append(extract_main(p))
        out.append("\n---\n")
    text = "\n".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def check_llms_index(top_pages: list[tuple[str, str, str, str]], blog_posts: list[tuple[str, str, str, str]]) -> list[str]:
    """Report pages on disk that aren't linked from llms.txt."""
    llms = (ROOT / "llms.txt").read_text() if (ROOT / "llms.txt").exists() else ""
    missing: list[str] = []
    for url, file, _, _ in top_pages + blog_posts:
        full = f"{SITE}{url}"
        if full not in llms:
            missing.append(full)
    return missing


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="exit non-zero if regenerated files would differ from on-disk")
    args = ap.parse_args()

    blog_posts = discover_blog_posts()
    all_pages = PAGES + blog_posts

    sitemap = build_sitemap(all_pages)
    llms_full = build_llms_full(PAGES, blog_posts)

    sm_path = ROOT / "sitemap.xml"
    lf_path = ROOT / "llms-full.txt"

    if args.check:
        problems: list[str] = []
        if sm_path.exists() and sm_path.read_text() != sitemap:
            problems.append("sitemap.xml is stale — run python3 scripts/regen-seo.py")
        if lf_path.exists() and lf_path.read_text() != llms_full:
            problems.append("llms-full.txt is stale — run python3 scripts/regen-seo.py")
        missing = check_llms_index(PAGES, blog_posts)
        if missing:
            problems.append("llms.txt is missing entries for: " + ", ".join(missing))
        if problems:
            for p in problems:
                print(f"FAIL: {p}", file=sys.stderr)
            return 1
        print(f"OK: sitemap ({len(all_pages)} URLs) + llms-full ({len(llms_full)} bytes) + llms.txt — all current.")
        return 0

    sm_path.write_text(sitemap)
    lf_path.write_text(llms_full)
    print(f"wrote sitemap.xml — {len(all_pages)} URLs")
    print(f"wrote llms-full.txt — {len(llms_full):,} bytes")

    missing = check_llms_index(PAGES, blog_posts)
    if missing:
        print()
        print("NOTE: llms.txt is hand-curated and missing entries for these pages:")
        for u in missing:
            print(f"  - {u}")
        print("Add a one-line description for each under the appropriate section in llms.txt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
