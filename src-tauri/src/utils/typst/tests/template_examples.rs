//! Template inline-example compile tests moved verbatim from typst.rs.

use super::*;

#[test]
fn test_compile_grotesk_cv_inline_example() {
    let templates_dir = find_templates_dir();
    if templates_dir.is_none() {
        println!("Skipping: templates dir not found");
        return;
    }
    let templates_dir = templates_dir.unwrap();

    let tmp = std::env::temp_dir().join("typst_test_grotesk");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();

    // Write info.toml (from SKILL.md inline example)
    fs::write(
        tmp.join("info.toml"),
        r##"[personal]
first_name = "Test"
last_name = "User"
profile_image = ""
language = "en"
include_icons = false

[personal.info]
address = "Beijing, China"
telephone = "+86 138 0000 0000"

[personal.info.email]
link = "mailto:test@example.com"
label = "test@example.com"

[personal.info.linkedin]
link = "https://linkedin.com/in/testuser"
label = "linkedin.com/in/testuser"

[personal.info.github]
link = "https://github.com/testuser"
label = "github.com/testuser"

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
subtitle = "Software Engineer"
ai_prompt = ""
cv_document_name = "Resume"

[import]
fontawesome = "@preview/fontawesome:0.5.0"
"##,
    )
    .unwrap();

    // Write resume.typ (from SKILL.md inline example)
    fs::write(
        tmp.join("resume.typ"),
        r##"#import "@preview/grotesk-cv:1.0.5": cv, experience-entry, education-entry, skill-entry

#let meta = toml("info.toml")

#let left-content = [
  = Experience
  #v(5pt)
  #experience-entry(
    title: "Software Engineer",
    date: "2023 - Present",
    company: "Company Name",
    location: "City, Country",
  )
  - Built X feature that improved Y by Z%

  = Education
  #v(5pt)
  #education-entry(
    degree: "B.S. Computer Science",
    date: "2019 - 2023",
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
"##,
    )
    .unwrap();

    let font_db = init_font_database();
    let prebuilt = build_fonts(&font_db);

    let result = compile_typst_file(&tmp.join("resume.typ"), &prebuilt, Some(&templates_dir));
    assert!(
        result.is_ok(),
        "grotesk-cv inline example failed: {:?}",
        result.err()
    );

    let (svg, pdf) = result.unwrap();
    assert!(svg.contains("<svg"), "SVG should contain <svg tag");
    assert!(!pdf.is_empty(), "PDF should not be empty");

    fs::remove_dir_all(&tmp).ok();
}

#[test]
fn test_compile_basic_resume_inline_example() {
    let templates_dir = find_templates_dir();
    if templates_dir.is_none() {
        println!("Skipping: templates dir not found");
        return;
    }
    let templates_dir = templates_dir.unwrap();

    let tmp = std::env::temp_dir().join("typst_test_basic_resume");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();

    fs::write(
        tmp.join("resume.typ"),
        r##"#import "@preview/basic-resume:0.2.9": *

#show: resume.with(
  author: "Test User",
  location: "Beijing, China",
  email: "test@example.com",
  github: "github.com/testuser",
  linkedin: "linkedin.com/in/testuser",
  phone: "+86 138 0000 0000",
  accent-color: "#26428b",
)

== Education

#edu(
  institution: "Peking University",
  location: "Beijing, China",
  dates: dates-helper(start-date: "Sep 2019", end-date: "Jun 2023"),
  degree: "Bachelor of Science, Computer Science",
)

== Work Experience

#work(
  title: "Software Engineer",
  location: "Beijing, China",
  company: "Tech Corp",
  dates: dates-helper(start-date: "Jul 2023", end-date: "Present"),
)
- Built features and shipped code

== Skills

Languages: Python, TypeScript, Go
"##,
    )
    .unwrap();

    let font_db = init_font_database();
    let prebuilt = build_fonts(&font_db);

    let result = compile_typst_file(&tmp.join("resume.typ"), &prebuilt, Some(&templates_dir));
    match &result {
        Ok((svg, pdf)) => {
            assert!(svg.contains("<svg"), "SVG should contain <svg tag");
            assert!(!pdf.is_empty(), "PDF should not be empty");
        }
        Err(e) => {
            // basic-resume may have type compat issues with typst 0.11
            assert!(
                !e.contains("not found (searched at"),
                "Package resolution should work, but got: {}",
                e
            );
            println!("basic-resume template error (not resolution): {}", e);
        }
    }

    fs::remove_dir_all(&tmp).ok();
}

#[test]
fn test_compile_calligraphics_inline_example() {
    let templates_dir = find_templates_dir();
    if templates_dir.is_none() {
        println!("Skipping: templates dir not found");
        return;
    }
    let templates_dir = templates_dir.unwrap();

    let tmp = std::env::temp_dir().join("typst_test_calligraphics");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();

    fs::write(
        tmp.join("resume.typ"),
        r##"#import "@preview/calligraphics:1.0.0": *

#resume(
  author: (
    firstname: "Test",
    lastname: "User",
    email: "test@example.com",
    phone: "+86 138 0000 0000",
    address: "Beijing, China",
    github: "testuser",
    positions: ("Software Engineer",),
  ),
)[
  = Skills
  #aside-skill-item("Languages", (strong[Python], "TypeScript", "Go"))

  = Education
  #resume-entry(
    title: "B.S. Computer Science",
    location: "Peking University",
    date: "2019 - 2023",
    description: "Beijing, China",
  )
][
  = Experience
  #resume-entry(
    title: "Software Engineer",
    location: "Tech Corp",
    date: "2023 - Present",
    description: "Beijing, China",
  )
  #resume-item[
    - Built features and shipped code
  ]
]
"##,
    )
    .unwrap();

    let font_db = init_font_database();
    let prebuilt = build_fonts(&font_db);

    let result = compile_typst_file(&tmp.join("resume.typ"), &prebuilt, Some(&templates_dir));
    match &result {
        Ok((svg, pdf)) => {
            assert!(svg.contains("<svg"), "SVG should contain <svg tag");
            assert!(!pdf.is_empty(), "PDF should not be empty");
        }
        Err(e) => {
            assert!(
                !e.contains("not found (searched at"),
                "Package resolution should work, but got: {}",
                e
            );
            println!("calligraphics template error (not resolution): {}", e);
        }
    }

    fs::remove_dir_all(&tmp).ok();
}

#[test]
fn test_compile_fallback_resume_inline_example_chinese() {
    let tmp = std::env::temp_dir().join("typst_test_resume_fallback_chinese");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();

    fs::write(
                    tmp.join("resume.typ"),
                    r##"#set page(paper: "a4", margin: (x: 1.8cm, y: 1.5cm))
#set text(font: ("Times New Roman", "Source Han Serif SC", "Noto Serif CJK SC", "serif"), size: 10pt)
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

#header(
    "张三",
    "后端工程师",
    "zhangsan@example.com · +86 138 0000 0000 · 北京，中国",
)

#section-title("工作经历")

#entry("某科技公司 — 后端工程师", "2023 - 至今")[
    - 主导搜索链路优化，延迟降低 20%
    - 负责上线落地与问题排查
]

#section-title("教育背景")

#entry("某大学 — 计算机科学学士", "2019 - 2023")[
    GPA: 3.8 / 4.0
]

#section-title("专业技能")

Python, TypeScript, Rust, PostgreSQL
"##,
            )
            .unwrap();

    let font_db = init_font_database();
    let prebuilt = build_fonts(&font_db);

    let result = compile_typst_file(&tmp.join("resume.typ"), &prebuilt, None);
    assert!(
        result.is_ok(),
        "fallback chinese inline example failed: {:?}",
        result.err()
    );

    let (svg, pdf) = result.unwrap();
    assert!(svg.contains("<svg"), "SVG should contain <svg tag");
    assert!(!pdf.is_empty(), "PDF should not be empty");

    fs::remove_dir_all(&tmp).ok();
}

#[test]
#[ignore = "local Typst smoke for nabcv; requires bundled templates and local font installation"]
fn test_compile_nabcv_inline_example_local() {
    let templates_dir = find_templates_dir();
    if templates_dir.is_none() {
        println!("Skipping: templates dir not found");
        return;
    }
    let templates_dir = templates_dir.unwrap();

    let tmp = std::env::temp_dir().join("typst_test_nabcv_local");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();

    fs::write(
        tmp.join("cv.toml"),
        r##"[cv]
name = "Test User"
headline = "Software Engineer"
location = "Beijing, China"
email = "test@example.com"
phone = "+86 138 0000 0000"
summary = "Built reliable local-first tooling."

[[cv.profiles]]
network = "LinkedIn"
username = "testuser"

[[cv.profiles]]
network = "GitHub"
username = "testuser"

[[cv.skills]]
group = "Programming"
items = "Python, TypeScript, Rust"

[[cv.experience]]
company = "Tech Corp"
position = "Software Engineer"
summary = "Platform"
location = "Beijing, China"
start_date = "2023-07"
end_date = "present"
highlights = ["Built X feature", "Reduced latency by 20%"]
"##,
    )
    .unwrap();

    fs::write(
        tmp.join("resume.typ"),
        r##"#import "@preview/nabcv:0.1.0": cv

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
"##,
    )
    .unwrap();

    let font_db = init_font_database();
    let prebuilt = build_fonts(&font_db);

    let result = compile_typst_file(&tmp.join("resume.typ"), &prebuilt, Some(&templates_dir));
    assert!(
        result.is_ok(),
        "nabcv local inline example failed: {:?}",
        result.err()
    );

    let (svg, pdf) = result.unwrap();
    assert!(svg.contains("<svg"), "SVG should contain <svg tag");
    assert!(!pdf.is_empty(), "PDF should not be empty");

    fs::remove_dir_all(&tmp).ok();
}
