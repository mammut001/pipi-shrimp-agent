---
name: resume
description: Professional Resume Generator using Typst templates with carousel selection.
---

# Resume Generation Skill

## Step 1 — Show Template Carousel

**IMPORTANT: Always start here.** Output a single fenced code block with language `resume-templates` and body `[]`. Example output (exactly 3 lines):

Line 1: three backticks followed by resume-templates
Line 2: []
Line 3: three backticks

This renders an interactive template carousel. Do NOT output it twice. Do NOT wrap it in markdown or other code blocks.
Wait for the user to select a template before proceeding.

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

### 3a. Write `.typ` file

Read the selected template's example from `src/skills/resume/templates/{template-id}/template/` to learn the API. Use Bash `cat` to read the example `.typ` file. Then write a `.typ` file to `{workDir}/resume.typ`.

Available templates (use `@preview/` import):
- **basic-resume** → `#import "@preview/basic-resume:0.2.9": *` — Functions: `resume()`, `edu()`, `work()`, `project()`, `dates-helper()`
- **brilliant-cv** → `#import "@preview/brilliant-cv:3.3.0": cv` — Metadata-driven with `metadata.toml`
- **calligraphics** → `#import "@preview/calligraphics:1.0.0": *` — Two-column: `resume(author: (...))[ left ][ right ]`
- **grotesk-cv** → `#import "@preview/grotesk-cv:1.0.5"` — Uses `info.toml` config
- **nabcv** → `#import "@preview/nabcv:0.1.0": cv` — Uses `cv.toml` config

### 3b. Compile

```bash
typst compile "{workDir}/resume.typ" "{workDir}/resume.pdf"
typst compile "{workDir}/resume.typ" "{workDir}/resume-preview.svg"
```

### 3c. Deliver

1. Show SVG preview in a ```svg code block
2. Tell user the PDF path
3. Offer adjustments

## Notes
- Expand brief user input into professional resume language with action verbs and metrics
- If `typst` CLI unavailable, fall back to built-in `render_typst_to_pdf` (only for self-contained source without `@preview` imports)
