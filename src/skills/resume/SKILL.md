---
name: resume
description: Professional Resume Generator using Typst templates with carousel selection.
---

# Resume Generation Skill

## Step 1 — Show Template Carousel

**Check conversation history first:** If the user has ALREADY selected a template (e.g., "I'd like to use the Basic Resume template"), SKIP Step 1 entirely and PROCEED IMMEDIATELY TO STEP 2.

If no template has been selected yet, output a single fenced code block with language `resume-templates` and body `[]`. 

**CRITICAL FORMATTING:** You MUST use exact newlines. Do not output inline. Example output (exactly 3 lines):
```resume-templates
[]
```

This renders an interactive template carousel. Do NOT output it twice. Do NOT wrap it in other markdown. Wait for the user to select a template before proceeding.

## Step 2 — Collect User Information

After the user selects a template, use `AskUserQuestion` to collect their info:

```json
{
  "title": "Resume Information",
  "description": "Fill in your details. Leave blank if not applicable.",
  "fields": [
    { "id": "name", "label": "Full Name", "type": "text", "required": true },
    { "id": "email", "label": "Email", "type": "text" },
    { "id": "phone", "label": "Phone", "type": "text" },
    { "id": "location", "label": "City, Country", "type": "text" },
    { "id": "linkedin", "label": "LinkedIn URL", "type": "text" },
    { "id": "github", "label": "GitHub URL", "type": "text" },
    { "id": "education", "label": "Education (school, degree, dates)", "type": "textarea" },
    { "id": "experience", "label": "Work Experience (company, role, dates, highlights)", "type": "textarea" },
    { "id": "projects", "label": "Projects (name, tech, description)", "type": "textarea" },
    { "id": "skills", "label": "Skills (languages, frameworks, tools)", "type": "textarea" }
  ]
}
```

If the user already provided info in their message, skip redundant fields.

## Step 3 — Generate Resume

### 3a. Read the template example

Use `read_file` or `execute_command` with `cat` to read the template's example `.typ` file:

| Template | Example file to read |
|----------|---------------------|
| basic-resume | `src/skills/resume/templates/basic-resume/template/main.typ` |
| brilliant-cv | `src/skills/resume/templates/brilliant-cv/template/cv.typ` |
| calligraphics | `src/skills/resume/templates/calligraphics/template/resume.typ` |
| grotesk-cv | `src/skills/resume/templates/grotesk-cv/src/template/cv.typ` + `src/skills/resume/templates/grotesk-cv/src/template/info.toml` |
| nabcv | `src/skills/resume/templates/nabcv/template/cv.typ` + `src/skills/resume/templates/nabcv/template/cv.toml` |

Study the example to understand the exact import syntax and API.

### 3b. Write files to `{workDir}`

**CRITICAL — Output directory:** Always write files to `{workDir}`. NEVER write files to `src/`, `src-tauri/`, or the project root. Writing files to `src-tauri/` will trigger a Rust recompile and crash the app.

Write the `.typ` file (and any config files the template requires, e.g. `info.toml`) to `{workDir}/`.

**CRITICAL — Import syntax:** You MUST copy the `#import` line EXACTLY from the template example. Common mistakes:
- ❌ `#show: grotesk-cv.with(...)` — Typst treats `grotesk-cv` as `grotesk - cv` (subtraction)
- ✅ `#import "@preview/grotesk-cv:1.0.5": cv` then `#show: cv.with(...)`
- ❌ Writing Typst code from memory — you WILL get syntax wrong
- ✅ Copy the template structure exactly, only change data values

**CRITICAL — Email addresses:** In Typst, `@` starts a label reference. Wrap emails in quotes or use `#link()`:
- ❌ `user@example.com` — Typst parses `@example.com` as a label
- ✅ `#link("mailto:user@example.com")[user\@example.com]`

### 3c. Compile

Use the `compile_typst_file` tool — it has built-in `@preview` package resolution:
```json
{
  "file_path": "{workDir}/resume.typ",
  "output_dir": "{workDir}"
}
```

This returns `pdf_path`, `svg_path`, and `svg` (SVG string for preview).

**Fallback** (only if `compile_typst_file` fails): use `render_typst_to_pdf` with the fallback template below.

### 3d. Deliver

1. Show SVG preview in a ```svg code block (from the `svg` field in compile result)
2. Tell user the PDF path
3. Offer adjustments

## Fallback Template (No `@preview` — works with `render_typst_to_pdf`)

If `compile_typst_file` fails (package not found, etc.), generate a self-contained `.typ` using ONLY built-in Typst features. Use `render_typst_to_svg` for preview and `render_typst_to_pdf` to save.

```typ
// === Self-contained resume template (no @preview imports) ===
#set page(paper: "a4", margin: (x: 1.8cm, y: 1.5cm))
#set text(font: "Times New Roman", size: 10pt)
#set par(justify: true, leading: 0.65em)

#let accent = rgb("#2b5797")
#let light-gray = rgb("#f5f5f5")

#let header(name, title, details) = {
  align(center)[
    #text(size: 22pt, weight: "bold", fill: accent)[#name]
    #v(2pt)
    #text(size: 12pt, fill: luma(100))[#title]
    #v(6pt)
    #text(size: 9pt, fill: luma(120))[#details]
  ]
  #v(8pt)
  #line(length: 100%, stroke: 0.5pt + accent)
}

#let section-title(title) = {
  v(10pt)
  text(size: 12pt, weight: "bold", fill: accent)[#title]
  v(2pt)
  line(length: 100%, stroke: 0.3pt + luma(200))
  v(4pt)
}

#let entry(left, right, body) = {
  grid(
    columns: (1fr, auto),
    text(weight: "bold")[#left],
    text(fill: luma(100), size: 9pt)[#right],
  )
  v(2pt)
  body
  v(6pt)
}

// === Fill in user data below ===
#header(
  "Full Name",
  "Job Title",
  "email · phone · location · linkedin · github",
)

#section-title("Work Experience")
#entry("Company — Role", "Start – End")[
  - Achievement with metrics and action verbs
]

#section-title("Education")
#entry("University — Degree", "Start – End")[
  GPA, honors, relevant coursework
]

#section-title("Skills")
Languages: ... · Frameworks: ... · Tools: ...
```

## Notes
- All 5 templates (`basic-resume`, `brilliant-cv`, `calligraphics`, `grotesk-cv`, `nabcv`) have their `@preview` dependencies pre-bundled. No network access needed.
- Expand brief user input into professional resume language with action verbs and metrics
- Do NOT retry the same failing Typst code more than once. If compilation fails, read the error carefully, fix the specific issue, then retry.
- If `compile_typst_file` errors mention a missing package, switch to the fallback template above.
