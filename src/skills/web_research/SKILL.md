---
name: web_research
description: Research a topic in a live browser using PageState-based navigation, extraction, and evidence synthesis.
official: true
version: 0.1.0
---

# Web Research Skill

Use this skill when the user wants live information gathered from websites instead of a static codebase or document search.

## Goal

Produce a short, evidence-backed answer by navigating pages, reading structured `browser_get_page` output, and extracting only the content needed to answer the user's question.

## Preferred Tool Sequence

1. Use `browser_navigate` to open the destination or a search engine.
2. Use `browser_get_page` after every meaningful navigation to inspect the current `PageState`.
3. Use `browser_click` and `browser_type` with `backend_node_id` when available; otherwise use `element_id`.
4. Use `browser_press_key` after typing into search boxes or forms.
5. Use `browser_wait` when the page is still loading or a result list is expected.
6. Use `browser_extract_content` or `browser_get_text` only after landing on the right page.

## Operating Rules

1. Prefer pages that already show the answer directly; do not open unnecessary tabs.
2. Re-read `browser_get_page` after clicks, form submits, or infinite-scroll changes.
3. If the page state warns about login, captcha, or blocked flows, stop and tell the user exactly what is needed.
4. Summaries must distinguish observed facts from inference.
5. Cite the page title and URL in the final natural-language answer.

## Minimal Demo Flow

1. `browser_navigate` to the target page or search engine.
2. `browser_get_page` to find the primary result.
3. `browser_click` the result using `backend_node_id`.
4. `browser_extract_content` to gather the answer.
5. Return a concise answer with the source URL.