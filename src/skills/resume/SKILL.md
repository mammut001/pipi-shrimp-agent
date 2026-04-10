---
name: resume
description: Professional Resume Generator using Typst. Extracts experience from chat and renders high-quality PDF/SVG resumes.
---

# Resume Generation Skill

This skill allows you to generate professional resumes using the modern **Typst** typesetting system.

## How it Works

1.  **Data Extraction**: When a user wants a resume, analyze the chat history or ask for specific details (Education, Experience, Skills).
2.  **Typst Generation**: Write a `.typ` file that imports the standard template and fills in the data.
3.  **PDF Rendering**: Use `render_typst_to_pdf(source, file_path)` to generate the final PDF for download.
4.  **SVG Preview**: Use `render_typst_to_svg(source)` to get an SVG string for instant preview in chat.
5.  **Artifact Return**: Include the SVG as an `image` artifact in the chat response.

## Typical Workflow

```typst
#import "assets/template.typ": *

#show: resume.with(
  author: "John Doe",
  location: "New York, NY",
  email: "john@example.com",
  phone: "+1 (555) 123-4567",
  github: "github.com/johndoe",
  linkedin: "linkedin.com/in/johndoe",
)

= Education

#edu_item(
  university: "University of Excellence",
  degree: "B.S. in Computer Science",
  location: "Springfield, IL",
  date: "2018 - 2022",
)

= Experience

#work_item(
  company: "Tech Solutions Inc.",
  position: "Full Stack Developer",
  location: "Boston, MA",
  date: "2022 - Present",
  bullets: (
    [Developed scalable microservices using **Node.js** and **Rust**.],
    [Improved application performance by 30% through database optimization.],
    [Led a team of 5 developers in delivering a mission-critical dashboard.],
  )
)

= Skills

- *Languages*: Python, JavaScript, Rust, SQL
- *Frameworks*: React, Next.js, FastAPI, Tauri
- *Tools*: Docker, Git, AWS, Typst
```

## Available Functions (from template.typ)

- `resume(...)`: Initial setup for the document.
- `edu_item(...)`: Entry for schools/degrees.
- `work_item(...)`: Entry for job experiences with bullet points.
- `project_item(...)`: Entry for personal projects.

## Output Format

When generation is complete, provide:
1.  The PDF file path to the user.
2.  An SVG artifact for visual confirmation.

Example response:
```markdown
I've generated your resume. You can find the PDF at: `/Users/user/resume.pdf`

<artifact id="resume-preview" title="Resume Preview" type="image" mimeType="image/svg+xml">
<svg ...>
</artifact>
```
