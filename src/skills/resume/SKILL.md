---
name: resume
description: Professional Resume Generator using Typst templates with carousel selection. Supports English and Chinese resumes with 5 curated templates plus a self-contained fallback.
version: 1.1.0
---

# Resume Generation Skill

## Overview

This skill guides the agent through a 3-step resume generation flow:

1. **Template selection** via an interactive carousel
2. **Structured information collection** via `AskUserQuestion`
3. **Resume generation** using Typst templates with strict API adherence and a hard fallback

The skill is designed to be **deterministic and failure-resistant**. The agent MUST follow the exact code patterns provided — guessing template APIs is the #1 cause of failure.

---

## Global Conventions (read before executing any step)

### Path resolution

`{workDir}` in this document refers to the **current session's scratch directory**. Resolve it in this order:

1. If the session provides a working directory variable, use it directly.
2. Otherwise, use `~/.pipi-shrimp/sessions/{session_id}/resume/` and create it if it doesn't exist.
3. If no session ID is available, fall back to `{OS_TEMP_DIR}/pipi-shrimp-resume-{timestamp}/`.

**NEVER** write to `src/`, `src-tauri/`, project root, or any path under the app installation directory.

### Character escaping

- Inside `.typ` files: `@` must be escaped as `\@` (e.g., `user\@example.com`). This is because `@` starts a label in Typst syntax.
- Inside `.toml` files: Do **NOT** escape `@`. Write it as-is (e.g., `user@example.com`).
- Inside user-visible strings (chat messages, log entries): no escaping.

### Compilation attempts

- **Maximum 2 total compile attempts per chosen template.**
- On the 1st failure: read the error, fix only the specific issue, retry once.
- On the 2nd failure: **stop** — switch to the Fallback Template (self-contained, no `@preview` dependencies).
- Do NOT attempt the same template a 3rd time. Do NOT silently retry.

---

## Step 1 — Show Template Carousel

**Skip condition**: If the user has already selected a template earlier in the conversation (e.g., "use basic-resume", "我想用 calligraphics"), skip this step entirely and proceed to Step 2.

If no template has been selected, output exactly the following — a fenced code block with language `resume-templates` and an empty JSON array body. Output ONLY this code block. No introduction, no explanation, no text before or after.

```resume-templates
[]
```

The UI will render an interactive carousel showing all 5 available templates. Wait for the user's selection before proceeding.

**Available templates** (the carousel knows these; listed here for your reference):

| ID | Name | Complexity | Best for |
|----|------|-----------|----------|
| `basic-resume` | Basic Resume | Simple ⭐ | Most users, tech roles |
| `calligraphics` | Calligraphics | Medium | Two-column designs |
| `nabcv` | Nabcv | Medium | Data-driven, TOML config |
| `grotesk-cv` | Grotesk CV | Advanced | Modern, customizable |
| `brilliant-cv` | Brilliant CV | Advanced | Polished, professional |

If the user asks "which should I pick?", recommend `basic-resume` by default.

---

## Step 2 — Collect User Information

### 2a. Detect language

Before asking questions, infer the resume language from the user's message history:
- If the user has been writing in Chinese → default `language = "中文"`
- If in English → default `language = "English"`
- If mixed or unclear → ask explicitly

### 2b. Basic information (first prompt)

Call `AskUserQuestion` with basic fields only. Do NOT overwhelm the user with a giant form.

```json
{
  "title": "Resume — Basic Info",
  "description": "Let's start with your contact details. Leave blank if not applicable.",
  "fields": [
    { "id": "language", "label": "Resume Language", "type": "select", "options": ["English", "中文", "Bilingual"], "required": true },
    { "id": "name", "label": "Full Name", "type": "text", "required": true },
    { "id": "title", "label": "Target Job Title", "type": "text" },
    { "id": "email", "label": "Email", "type": "text" },
    { "id": "phone", "label": "Phone", "type": "text" },
    { "id": "location", "label": "City, Country", "type": "text" },
    { "id": "linkedin", "label": "LinkedIn URL", "type": "text" },
    { "id": "github", "label": "GitHub URL", "type": "text" }
  ]
}
```

### 2c. Content information (second prompt)

After the user submits basic info, ask for resume content:

```json
{
  "title": "Resume — Content",
  "description": "Now the meat of your resume. Rough notes are fine — I'll polish them.",
  "fields": [
    { "id": "education", "label": "Education (school, degree, dates, GPA)", "type": "textarea" },
    { "id": "experience", "label": "Work Experience (company, role, dates, what you did)", "type": "textarea" },
    { "id": "projects", "label": "Projects (name, tech stack, description)", "type": "textarea" },
    { "id": "skills", "label": "Skills (languages, frameworks, tools)", "type": "textarea" }
  ]
}
```

### 2d. Skip fields already provided

If the user already mentioned specific information in their message (e.g., "I'm John Doe, a Python developer"), pre-fill those fields and don't re-ask. Only ask for what's missing.

---

## Step 3 — Generate Resume

### 3a. Content expansion rules

When writing the resume, expand the user's rough notes into professional prose:

- **Use action verbs**: Built, Designed, Led, Shipped, Optimized, Architected, Reduced, Scaled.
- **Add metrics when reasonable**: "served X users", "reduced latency by Y%", "team of N engineers".
- **NEVER fabricate specific numbers** the user didn't provide. If you want to suggest a metric but don't have the data, use a placeholder like `[N]` or `[X%]` and tell the user at the end to fill it in.
- **Translate naturally if needed**: "做了个聊天机器人" → "Designed and deployed a production chatbot". Don't translate literally.
- **Keep bullets concise**: Ideal is 1–2 lines per bullet, starting with a verb.

### 3b. Language-aware font selection

Choose the font based on the detected language:

| Language | Recommended font | Fallback |
|----------|-----------------|----------|
| English | `New Computer Modern` or `Times New Roman` | `serif` |
| 中文 | `Source Han Serif SC` | `Noto Serif CJK SC`, `PingFang SC`, `SimSun` |
| Bilingual | `Source Han Serif SC` (handles both) | same as 中文 |

When in doubt for Chinese, use:
```typ
#set text(font: ("Times New Roman", "Source Han Serif SC", "Noto Serif CJK SC"))
```

### 3c. Write files to `{workDir}`

Use the EXACT code structure from the matching template below. Only change data values — never invent new function signatures or argument names.

---

#### Template: `basic-resume` ⭐ RECOMMENDED

Write ONE file: `{workDir}/resume.typ`

```typ
#import "@preview/basic-resume:0.2.9": *

#show: resume.with(
  author: "Full Name",
  location: "City, Country",
  email: "user\@example.com",
  github: "github.com/username",
  linkedin: "linkedin.com/in/username",
  phone: "+1 (555) 000-0000",
  accent-color: "#26428b",
)

== Education

#edu(
  institution: "University Name",
  location: "City, Country",
  dates: dates-helper(start-date: "Sep 2019", end-date: "Jun 2023"),
  degree: "Bachelor of Science, Computer Science",
)
- GPA: 3.8/4.0

== Work Experience

#work(
  title: "Software Engineer",
  location: "City, Country",
  company: "Company Name",
  dates: dates-helper(start-date: "Jul 2023", end-date: "Present"),
)
- Built X feature that improved Y metric by Z%
- Led team of N engineers to deliver project on time

== Projects

#project(
  name: "Project Name",
  url: "https://github.com/user/project",
  dates: dates-helper(start-date: "Jan 2023", end-date: "Mar 2023"),
)
- Description of what you built and technologies used

== Skills

#generic-one-by-two(
  left: [*Languages:* Python, TypeScript, Go],
  right: [*Frameworks:* React, FastAPI, Django],
)

#generic-one-by-two(
  left: [*Tools:* Git, Docker, AWS],
  right: [*Databases:* PostgreSQL, Redis],
)
```

---

#### Template: `calligraphics`

Write ONE file: `{workDir}/resume.typ`

```typ
#import "@preview/calligraphics:1.0.0": *

#resume(
  author: (
    firstname: "First",
    lastname: "Last",
    email: "user\@example.com",
    phone: "+1 555 000 0000",
    address: "City, Country",
    github: "username",
    positions: ("Software Engineer",),
  ),
)[
  // LEFT COLUMN — sidebar
  = Skills
  #aside-skill-item("Languages", (strong[Python], "TypeScript", "Go"))
  #aside-skill-item("Frameworks", ("React", "FastAPI", "Django"))
  #aside-skill-item("Tools", ("Git", "Docker", "AWS"))

  = Education
  #resume-entry(
    title: "B.S. Computer Science",
    location: "University Name",
    date: "2019 - 2023",
    description: "City, Country",
  )
][
  // RIGHT COLUMN — main content
  = Experience
  #resume-entry(
    title: "Software Engineer",
    location: "Company Name",
    date: "2023 - Present",
    description: "City, Country",
  )
  #resume-item[
    - Built X feature that improved Y metric by Z%
    - Led team of N engineers to deliver project
  ]

  = Projects
  #resume-entry(
    title: "Project Name",
    location: "github.com/user/project",
    date: "2023",
    description: "Description",
  )
  #resume-item[
    - What you built and technologies used
  ]
]
```

---

#### Template: `nabcv`

Write TWO files.

**File 1: `{workDir}/cv.toml`** (note: `@` is NOT escaped in TOML)

```toml
[cv]
name     = "Full Name"
headline = "Software Engineer"
location = "City, Country"
email    = "user@example.com"
phone    = "+1 555 000 0000"
summary  = "Experienced engineer with expertise in X, Y, Z."

[[cv.profiles]]
network  = "LinkedIn"
username = "username"

[[cv.profiles]]
network  = "GitHub"
username = "username"

[[cv.skills]]
group = "Programming"
items = "Python, TypeScript, Go, SQL"

[[cv.skills]]
group = "Tools & Cloud"
items = "Docker, AWS, Git, PostgreSQL"

[[cv.experience]]
company    = "Company Name"
position   = "Software Engineer"
summary    = "Engineering"
location   = "City, Country"
start_date = "2023-07"
end_date   = "present"
highlights = [
  "Built X feature that improved Y by Z%",
  "Led team of N engineers",
]

[[cv.education]]
institution = "University Name"
area        = "Computer Science"
study_type  = "Bachelor of Science"
location    = "City, Country"
start_date  = "2019-09"
end_date    = "2023-06"
```

**File 2: `{workDir}/resume.typ`**

```typ
#import "@preview/nabcv:0.1.0": cv

#let cd = toml("cv.toml").cv

#show: cv.with(
  name: cd.name,
  headline: cd.at("headline", default: none),
  location: cd.at("location", default: none),
  email: cd.at("email", default: none),
  phone: cd.at("phone", default: none),
  profiles: cd.at("profiles", default: none),
  summary: cd.at("summary", default: none),
  experience: cd.at("experience", default: none),
  education: cd.at("education", default: none),
  skills: cd.at("skills", default: none),
)
```

---

#### Template: `grotesk-cv`

Write TWO files.

**File 1: `{workDir}/info.toml`**

```toml
[personal]
first_name = "First"
last_name = "Last"
profile_image = ""
language = "en"
include_icons = false

[personal.info]
address = "City, Country"
telephone = "+1 555 000 0000"

[personal.info.email]
link = "mailto:user@example.com"
label = "user@example.com"

[personal.info.linkedin]
link = "https://linkedin.com/in/username"
label = "linkedin.com/in/username"

[personal.info.github]
link = "https://github.com/username"
label = "github.com/username"

[personal.icon]
address = "house"
telephone = "phone"
email = "envelope"
linkedin = "linkedin"
github = "github"
homepage = "globe"

[personal.ia]
inject_ai_prompt = false
inject_keywords = false
keywords_list = []

[section.icon]
education = "graduation-cap"
experience = "briefcase"
skills = "cogs"
profile = "id-card"

[layout]
fill_color = "#f4f1eb"
paper_size = "a4"
accent_color = "#d4d2cc"
left_pane_width = "71%"

[layout.text]
font = "Times New Roman"
size = "10pt"
cover_letter_size = "11pt"

[layout.text.color]
light = "#ededef"
medium = "#78787e"
dark = "#3c3c42"

[language.en]
subtitle = "Job Title or Tagline"
ai_prompt = ""
cv_document_name = "Resume"

[import]
fontawesome = "@preview/fontawesome:0.5.0"
```

**File 2: `{workDir}/resume.typ`**

```typ
#import "@preview/grotesk-cv:1.0.5": cv, experience-entry, education-entry, skill-entry

#let meta = toml("info.toml")

#let left-content = [
  = Experience
  #v(5pt)
  #experience-entry(
    title: "Software Engineer",
    date: "2023 – Present",
    company: "Company Name",
    location: "City, Country",
  )
  - Built X feature that improved Y by Z%

  = Education
  #v(5pt)
  #education-entry(
    degree: "B.S. Computer Science",
    date: "2019 – 2023",
    institution: "University Name",
    location: "City, Country",
  )
]

#let right-content = [
  = Skills
  #v(5pt)
  #skill-entry(
    meta.layout.accent_color,
    true,
    center,
    skills: ("Python", "TypeScript", "Go", "React", "Docker", "AWS"),
  )
]

#show: cv.with(
  meta,
  use-photo: false,
  left-pane: left-content,
  right-pane: right-content,
  left-pane-proportion: eval(meta.layout.left_pane_width),
)
```

---

#### Template: `brilliant-cv`

This template is the most complex. It uses `@preview/brilliant-cv:3.3.0` and requires a detailed `metadata.toml` plus separate module files per section. Write at minimum THREE files.

**File 1: `{workDir}/metadata.toml`** (note: `@` is NOT escaped in TOML)

```toml
language = "en"

[layout]
awesome_color = "skyblue"
before_section_skip = "1pt"
before_entry_skip = "1pt"
before_entry_description_skip = "1pt"
paper_size = "a4"

[layout.fonts]
regular_fonts = ["Times New Roman"]
header_font = "Times New Roman"

[layout.header]
header_align = "left"
display_profile_photo = false
profile_photo_radius = "50%"
info_font_size = "10pt"

[layout.entry]
display_entry_society_first = true
display_logo = false

[layout.footer]
display_page_counter = false
display_footer = false

[inject]
injected_keywords_list = []

[personal]
first_name = "First"
last_name = "Last"

[personal.info]
phone = "+1 555 000 0000"
email = "user@example.com"
linkedin = "username"
github = "username"
location = "City, Country"

[lang.en]
header_quote = "Experienced Software Engineer"
cv_footer = "Resume"
letter_footer = "Cover Letter"
```

**File 2: `{workDir}/resume.typ`**

```typ
#import "@preview/brilliant-cv:3.3.0": cv

#let metadata = toml("metadata.toml")

#show: cv.with(metadata)

#include "modules_en/experience.typ"
#include "modules_en/education.typ"
#include "modules_en/skills.typ"
```

**File 3: `{workDir}/modules_en/experience.typ`**

```typ
#import "@preview/brilliant-cv:3.3.0": cv-section, cv-entry

#cv-section("Professional Experience")

#cv-entry(
  title: [Software Engineer],
  society: [Company Name],
  date: [2023 – Present],
  location: [City, Country],
  description: list(
    [Built X feature that improved Y metric by Z%],
    [Led team of N engineers to deliver project on time],
  ),
)
```

**File 4: `{workDir}/modules_en/education.typ`**

```typ
#import "@preview/brilliant-cv:3.3.0": cv-section, cv-entry

#cv-section("Education")

#cv-entry(
  title: [Bachelor of Science, Computer Science],
  society: [University Name],
  date: [2019 – 2023],
  location: [City, Country],
  description: list(
    [GPA: 3.8/4.0],
  ),
)
```

**File 5: `{workDir}/modules_en/skills.typ`**

```typ
#import "@preview/brilliant-cv:3.3.0": cv-section

#cv-section("Skills")

*Languages:* Python, TypeScript, Go \
*Frameworks:* React, FastAPI, Django \
*Tools:* Git, Docker, AWS, PostgreSQL
```

**Important:** If `brilliant-cv:3.3.0` fails with any API error, switch to Fallback Template immediately. Do not try to fix the API.

---

### 3d. Compile

Use the `compile_typst_file` tool (it resolves `@preview` packages automatically):

```json
{
  "file_path": "{workDir}/resume.typ",
  "output_dir": "{workDir}"
}
```

Expected return: `{ "pdf_path": "...", "svg_path": "...", "svg": "<svg>...</svg>" }`.

### 3e. Handle compile failure

**1st failure**: Read the error message carefully. Fix only the specific issue mentioned (usually a typo, missing argument, or wrong type). Retry once.

**2nd failure**: Stop retrying the current template. Proceed to Fallback Template below.

**Environment errors** (Typst binary not found, permission denied, etc.): Do NOT switch to Fallback. Report the error to the user and stop.

### 3f. Deliver

After a successful compile, respond with this exact structure:

```
{svg_content_from_compile_result}

✅ Resume generated successfully using the {template_name} template.
📄 PDF saved to: `{pdf_path}`

Would you like to:
- Adjust any section content?
- Try a different template?
- Change colors, fonts, or layout?
- Add/remove sections?
```

If you used placeholder metrics (like `[N]` or `[X%]`), add a separate note:

> ⚠️ I used placeholders for some metrics you didn't specify. Please replace `[N]`, `[X%]`, etc. with your actual numbers before sending the resume.

---

## Fallback Template (self-contained, no `@preview`)

Triggered when the chosen template fails twice. This template uses ONLY built-in Typst features and is guaranteed to compile on any working Typst installation.

Write ONE file: `{workDir}/resume.typ` using this exact structure. Use `render_typst_to_svg` for the preview and `render_typst_to_pdf` to save.

```typ
// === Self-contained resume template (no @preview imports) ===
#set page(paper: "a4", margin: (x: 1.8cm, y: 1.5cm))
#set text(font: ("Times New Roman", "Source Han Serif SC"), size: 10pt)
#set par(justify: true, leading: 0.65em)

#let accent = rgb("#2b5797")

#let header(name, title, details) = {
  align(center)[
    #text(size: 22pt, weight: "bold", fill: accent)[#name]
    #v(2pt)
    #text(size: 12pt, fill: luma(100))[#title]
    #v(6pt)
    #text(size: 9pt, fill: luma(120))[#details]
  ]
  v(8pt)
  line(length: 100%, stroke: 0.5pt + accent)
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
  "Target Job Title",
  "email · phone · location · linkedin · github",
)

#section-title("Work Experience")

#entry("Company Name — Software Engineer", "Jul 2023 – Present")[
  - Built X feature that improved Y metric by Z%
  - Led team of N engineers to deliver project on time
]

#section-title("Education")

#entry("University Name — B.S. Computer Science", "Sep 2019 – Jun 2023")[
  GPA: 3.8/4.0 · Relevant coursework: Algorithms, Systems, ML
]

#section-title("Projects")

#entry("Project Name", "Jan 2023 – Mar 2023")[
  - What you built and technologies used
]

#section-title("Skills")

*Languages:* Python, TypeScript, Go \
*Frameworks:* React, FastAPI, Django \
*Tools:* Git, Docker, AWS, PostgreSQL
```

When delivering a Fallback result, tell the user:

> ℹ️ The original template had a compatibility issue, so I used a built-in fallback template. The content is identical — only the visual style is simpler. Let me know if you'd like to try a different template.

---

## Notes and Constraints

- All 5 `@preview` templates have their dependencies pre-bundled. No network access needed at compile time.
- **NEVER invent Typst API.** If a function name or argument isn't in the examples above, don't use it.
- **NEVER fabricate user data.** Use placeholders like `[N]` when a metric is unknown.
- **NEVER write files outside `{workDir}`.**
- **Max 2 compile attempts per template.** Switch to Fallback on the second failure.
- If the user's input contains CJK characters, always include a CJK font in the font list.
- If the user wants bilingual output, generate both halves in a single document with clear section separation.
- After delivery, remain available for iterative adjustments — re-run compile only on the specific section that changed when possible.
