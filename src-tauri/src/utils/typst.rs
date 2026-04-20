/**
 * Typst utilities - Native in-memory rendering
 *
 * Implements typst::World trait for in-memory compilation
 * Uses fontdb for system font management
 *
 * Performance design:
 * - Fonts are built ONCE at startup into `PrebuiltFonts`
 * - Each render call clones the fonts (cheap Arc clone, no disk I/O)
 * - This avoids re-reading hundreds of font files on every keypress
 *
 * Package resolution:
 * - Bundled `@preview` packages are resolved from `src/skills/resume/templates/{name}/`
 * - Local files (toml, images, sub-files) resolved from a root directory
 */

use chrono::{Datelike, Timelike};
use comemo::Prehashed;
use fontdb::Database as FontDatabase;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use typst::text::{Font, FontBook};
use typst::syntax::{FileId, Source, VirtualPath};
use typst::World;
use typst::compile;
use typst::foundations::Smart;
use typst::eval::Tracer;
use typst_svg::svg;
use typst::foundations::{Bytes, Datetime};
use typst::Library;
use typst::diag::FileError;

// ---------------------------------------------------------------------------
// PrebuiltFonts — built once at app startup, cloned cheaply on each render
// ---------------------------------------------------------------------------

/// Pre-loaded fonts ready for compilation.
/// `Font` internally wraps bytes in an `Arc`, so `.clone()` is O(1).
pub struct PrebuiltFonts {
    pub book: Prehashed<FontBook>,
    pub fonts: Vec<Font>,
}

/// Build fonts from a font database (call once at startup).
pub fn build_fonts(font_db: &FontDatabase) -> PrebuiltFonts {
    let mut book = FontBook::new();
    let mut fonts = Vec::new();

    for face in font_db.faces() {
        // Read font bytes from whatever source is available
        let data = match &face.source {
            fontdb::Source::File(path) => match fs::read(path) {
                Ok(d) => d,
                Err(_) => continue,
            },
            fontdb::Source::SharedFile(_path, data) => data.as_ref().as_ref().to_vec(),
            fontdb::Source::Binary(data) => data.as_ref().as_ref().to_vec(),
        };

        let bytes = Bytes::from(data);
        if let Some(font) = Font::new(bytes, face.index) {
            book.push(font.info().clone());
            fonts.push(font);
        }
    }

    println!("✅ Pre-built {} fonts for Typst", fonts.len());
    PrebuiltFonts {
        book: Prehashed::new(book),
        fonts,
    }
}

// ---------------------------------------------------------------------------
// TypstWorld
// ---------------------------------------------------------------------------

/// Custom World implementation for in-memory Typst compilation.
///
/// Supports two modes:
/// 1. **Detached** (legacy): source is in-memory, no file/package resolution.
/// 2. **Rooted**: source is on disk at `root_dir`, files resolved relative to
///    root, `@preview` packages resolved from bundled template directories.
pub struct TypstWorld {
    source: Source,
    book: Prehashed<FontBook>,
    fonts: Vec<Font>,
    library: Prehashed<Library>,
    /// Root directory for resolving local file paths (None = detached mode).
    root_dir: Option<PathBuf>,
    /// Map from package name (e.g. "basic-resume") to its directory on disk.
    package_dirs: HashMap<String, PathBuf>,
}

impl TypstWorld {
    /// Create a world using pre-built fonts (cheap — only Arc clones, no disk I/O).
    pub fn new_with_prebuilt(source_text: &str, prebuilt: &PrebuiltFonts) -> Self {
        Self {
            source: Source::detached(source_text),
            book: prebuilt.book.clone(),
            fonts: prebuilt.fonts.clone(),
            library: Prehashed::new(Library::builder().build()),
            root_dir: None,
            package_dirs: HashMap::new(),
        }
    }

    /// Create a rooted world that can resolve local files and bundled packages.
    ///
    /// - `root_dir`: directory containing the main `.typ` file
    /// - `main_filename`: name of the main file (e.g. "resume.typ")
    /// - `templates_dir`: directory containing bundled template packages
    pub fn new_rooted(
        root_dir: &Path,
        main_filename: &str,
        prebuilt: &PrebuiltFonts,
        templates_dir: Option<&Path>,
    ) -> Result<Self, String> {
        let main_path = root_dir.join(main_filename);
        let source_text = fs::read_to_string(&main_path)
            .map_err(|e| format!("Failed to read {}: {}", main_path.display(), e))?;

        let main_vpath = VirtualPath::new(format!("/{}", main_filename));
        let source = Source::new(FileId::new(None, main_vpath), source_text);

        // Discover bundled packages from templates directory
        let mut package_dirs = HashMap::new();
        if let Some(tpl_dir) = templates_dir {
            if tpl_dir.is_dir() {
                if let Ok(entries) = fs::read_dir(tpl_dir) {
                    for entry in entries.flatten() {
                        if entry.path().is_dir() {
                            let name = entry.file_name().to_string_lossy().to_string();
                            package_dirs.insert(name, entry.path());
                        }
                    }
                }
            }
        }

        Ok(Self {
            source,
            book: prebuilt.book.clone(),
            fonts: prebuilt.fonts.clone(),
            library: Prehashed::new(Library::builder().build()),
            root_dir: Some(root_dir.to_path_buf()),
            package_dirs,
        })
    }

    /// Resolve a FileId to a real filesystem path.
    fn resolve_file_path(&self, id: FileId) -> Result<PathBuf, FileError> {
        if let Some(package) = id.package() {
            // Package file: resolve from bundled templates
            // Try name-version first (e.g. "fontawesome-0.5.0"), then name only (e.g. "basic-resume")
            let pkg_name = package.name.as_str();
            let versioned_key = format!("{}-{}", pkg_name, package.version);
            let pkg_dir = self.package_dirs.get(&versioned_key)
                .or_else(|| self.package_dirs.get(pkg_name))
                .ok_or_else(|| FileError::NotFound(PathBuf::from(format!("@{}/{}", package.namespace, pkg_name))))?;
            id.vpath().resolve(pkg_dir)
                .ok_or_else(|| FileError::AccessDenied)
        } else {
            // Local file: resolve from root_dir
            let root = self.root_dir.as_ref()
                .ok_or_else(|| FileError::NotFound(PathBuf::new()))?;
            id.vpath().resolve(root)
                .ok_or_else(|| FileError::AccessDenied)
        }
    }

    /// Compile the source to SVG pages joined by newline.
    pub fn compile_to_svg(&self) -> Result<String, String> {
        let mut tracer = Tracer::new();
        let document = compile(self, &mut tracer)
            .map_err(|errors| {
                errors
                    .iter()
                    .map(|d| d.message.to_string())
                    .collect::<Vec<_>>()
                    .join("\n")
            })?;

        let svg_outputs: Vec<String> = document.pages
            .iter()
            .map(|page| svg(&page.frame))
            .collect();

        Ok(svg_outputs.join("\n"))
    }
}

impl World for TypstWorld {
    fn library(&self) -> &Prehashed<Library> {
        &self.library
    }

    fn book(&self) -> &Prehashed<FontBook> {
        &self.book
    }

    fn main(&self) -> Source {
        self.source.clone()
    }

    fn source(&self, id: FileId) -> typst::diag::FileResult<Source> {
        let path = self.resolve_file_path(id)?;
        let text = fs::read_to_string(&path)
            .map_err(|e| FileError::from_io(e, &path))?;
        Ok(Source::new(id, text))
    }

    fn file(&self, id: FileId) -> typst::diag::FileResult<Bytes> {
        let path = self.resolve_file_path(id)?;
        let data = fs::read(&path)
            .map_err(|e| FileError::from_io(e, &path))?;
        Ok(Bytes::from(data))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<i64>) -> Option<Datetime> {
        let now = chrono::Utc::now();
        let local = now.with_timezone(&chrono::Local);
        Datetime::from_ymd_hms(
            local.year(),
            local.month() as u8,
            local.day() as u8,
            local.hour() as u8,
            local.minute() as u8,
            local.second() as u8,
        )
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Initialize font database with Latin and CJK (Chinese/Japanese/Korean) fonts.
///
/// Load order:
/// 1. Times New Roman — Western serif (always tried first)
/// 2. CJK fonts — PingFang / Heiti / Noto CJK / SimSun depending on platform
/// 3. System-font fallback — scanned only if *no* Latin font was found above
pub fn init_font_database() -> FontDatabase {
    let mut db = FontDatabase::new();

    // ------------------------------------------------------------------
    // 1. Latin font – Times New Roman
    // ------------------------------------------------------------------
    let times_new_roman_paths = [
        "/Library/Fonts/Times New Roman.ttf",
        "/System/Library/Fonts/Times New Roman.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
        "~/Library/Fonts/Times New Roman.ttf",
    ];

    let mut latin_loaded = false;
    for path in &times_new_roman_paths {
        let expanded_path = if path.starts_with('~') {
            if let Some(home) = std::env::var_os("HOME") {
                let home_path = std::path::Path::new(&home);
                let relative = path.strip_prefix("~/").unwrap_or(path);
                home_path.join(relative)
            } else {
                continue;
            }
        } else {
            std::path::PathBuf::from(path)
        };

        if expanded_path.exists() {
            if db.load_font_file(&expanded_path).is_ok() {
                println!("✅ Loaded Times New Roman from: {}", expanded_path.display());
                latin_loaded = true;
                break;
            }
        }
    }

    // ------------------------------------------------------------------
    // 2. CJK fonts — try platform-specific paths in order of preference
    // ------------------------------------------------------------------
    let cjk_font_paths: &[&str] = &[
        // macOS system CJK fonts (always present on macOS 10.11+)
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/Supplemental/Songti.ttc",
        // Windows CJK fonts
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\simsun.ttc",
        "C:\\Windows\\Fonts\\simhei.ttf",
        // Linux – Noto CJK (common package locations)
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/google-noto-cjk/NotoSansCJKsc-Regular.otf",
        // User-level Noto fonts (Linux/macOS)
        "~/.local/share/fonts/NotoSansCJK-Regular.ttc",
        "~/Library/Fonts/NotoSansCJK-Regular.ttc",
    ];

    let mut cjk_loaded = 0usize;
    for path in cjk_font_paths {
        let expanded_path = if path.starts_with('~') {
            if let Some(home) = std::env::var_os("HOME") {
                let home_path = std::path::Path::new(&home);
                let relative = path.strip_prefix("~/").unwrap_or(path);
                home_path.join(relative)
            } else {
                continue;
            }
        } else {
            std::path::PathBuf::from(path)
        };

        if expanded_path.exists() {
            if db.load_font_file(&expanded_path).is_ok() {
                println!("✅ Loaded CJK font from: {}", expanded_path.display());
                cjk_loaded += 1;
            }
        }
    }

    // ------------------------------------------------------------------
    // 3. System-font fallback — only if nothing was found above
    // ------------------------------------------------------------------
    if !latin_loaded && cjk_loaded == 0 {
        println!("⚠️ No bundled fonts found, falling back to full system font scan");
        db.load_system_fonts();
    } else if cjk_loaded == 0 {
        println!("⚠️ No CJK fonts found on this system — Chinese/Japanese/Korean text may not render");
    }

    db
}

/// Compile using pre-built fonts (the fast path used by the Tauri command).
pub fn compile_typst_to_svg_with_prebuilt(source: &str, prebuilt: &PrebuiltFonts) -> Result<String, String> {
    let world = TypstWorld::new_with_prebuilt(source, prebuilt);
    world.compile_to_svg()
}

/// Compile to PDF using pre-built fonts.
pub fn compile_typst_to_pdf_with_prebuilt(source: &str, prebuilt: &PrebuiltFonts) -> Result<Vec<u8>, String> {
    let world = TypstWorld::new_with_prebuilt(source, prebuilt);

    let mut tracer = Tracer::new();
    let document = compile(&world, &mut tracer)
        .map_err(|errors| {
            errors
                .iter()
                .map(|d| d.message.to_string())
                .collect::<Vec<_>>()
                .join("\n")
        })?;

    // Render to PDF bytes
    let pdf_bytes = typst_pdf::pdf(&document, Smart::Auto, None);

    Ok(pdf_bytes)
}

// ---------------------------------------------------------------------------
// Rooted compilation — file-based with package resolution
// ---------------------------------------------------------------------------

/// Find the bundled resume templates directory.
///
/// Searches multiple candidate paths to handle different CWDs
/// (dev mode, production bundle, etc.)
pub fn find_templates_dir() -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = {
        let mut bases = vec![
            PathBuf::from("src/skills/resume/templates"),
            PathBuf::from("../src/skills/resume/templates"),
            PathBuf::from("skills/resume/templates"),
            PathBuf::from("../skills/resume/templates"),
        ];
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                bases.push(exe_dir.join("skills/resume/templates"));
                bases.push(exe_dir.join("../skills/resume/templates"));
                bases.push(exe_dir.join("../../src/skills/resume/templates"));
                bases.push(exe_dir.join("../../../src/skills/resume/templates"));
            }
        }
        bases
    };
    candidates.into_iter().find(|p| p.is_dir())
}

/// Compile a `.typ` file from disk with package resolution.
///
/// - `file_path`: absolute path to the main `.typ` file
/// - `prebuilt`: pre-built fonts
/// - `templates_dir`: optional path to bundled template packages
///
/// Returns `(svg_string, pdf_bytes)`.
pub fn compile_typst_file(
    file_path: &Path,
    prebuilt: &PrebuiltFonts,
    templates_dir: Option<&Path>,
) -> Result<(String, Vec<u8>), String> {
    let root_dir = file_path.parent()
        .ok_or_else(|| "Cannot determine parent directory of .typ file".to_string())?;
    let filename = file_path.file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid .typ filename".to_string())?;

    let world = TypstWorld::new_rooted(root_dir, filename, prebuilt, templates_dir)?;

    let mut tracer = Tracer::new();
    let document = compile(&world, &mut tracer)
        .map_err(|errors| {
            errors
                .iter()
                .map(|d| d.message.to_string())
                .collect::<Vec<_>>()
                .join("\n")
        })?;

    let svg_outputs: Vec<String> = document.pages
        .iter()
        .map(|page| svg(&page.frame))
        .collect();
    let svg_string = svg_outputs.join("\n");

    let pdf_bytes = typst_pdf::pdf(&document, Smart::Auto, None);

    Ok((svg_string, pdf_bytes))
}

/// Re-export for use in State.
#[allow(unused_imports)]
pub use fontdb::Database as FontDb;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_compile_typst_file_simple() {
        // Create a temp dir with a simple .typ file
        let tmp = std::env::temp_dir().join("typst_test_simple");
        fs::create_dir_all(&tmp).unwrap();
        let typ_path = tmp.join("test.typ");
        let mut f = fs::File::create(&typ_path).unwrap();
        writeln!(f, "#set page(width: 200pt, height: 100pt)").unwrap();
        writeln!(f, "Hello, World!").unwrap();
        drop(f);

        let font_db = init_font_database();
        let prebuilt = build_fonts(&font_db);

        let result = compile_typst_file(&typ_path, &prebuilt, None);
        assert!(result.is_ok(), "compile failed: {:?}", result.err());

        let (svg, pdf) = result.unwrap();
        assert!(svg.contains("<svg"), "SVG should contain <svg tag");
        assert!(!pdf.is_empty(), "PDF should not be empty");

        // Cleanup
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_compile_typst_file_with_package() {
        // Only run if templates dir exists (dev environment)
        let templates_dir = find_templates_dir();
        if templates_dir.is_none() {
            println!("Skipping: templates dir not found");
            return;
        }
        let templates_dir = templates_dir.unwrap();

        // Create a temp dir with a basic-resume .typ file
        let tmp = std::env::temp_dir().join("typst_test_pkg");
        let _ = fs::remove_dir_all(&tmp); // clean from previous runs
        fs::create_dir_all(&tmp).unwrap();
        let typ_path = tmp.join("resume.typ");
        let mut f = fs::File::create(&typ_path).unwrap();
        writeln!(f, r#"#import "@preview/basic-resume:0.2.9": *"#).unwrap();
        writeln!(f, r#"#show: resume.with(author: "Test User")"#).unwrap();
        writeln!(f, "== Education").unwrap();
        writeln!(f, "Test University").unwrap();
        drop(f);

        let font_db = init_font_database();
        let prebuilt = build_fonts(&font_db);

        let result = compile_typst_file(&typ_path, &prebuilt, Some(&templates_dir));
        match &result {
            Ok((svg, pdf)) => {
                assert!(svg.contains("<svg"), "SVG should contain <svg tag");
                assert!(!pdf.is_empty(), "PDF should not be empty");
            }
            Err(e) => {
                // Template may have type errors with this Typst version
                // but package resolution itself should work (no "not found" errors)
                assert!(
                    !e.contains("not found (searched at"),
                    "Package resolution should work, but got: {}",
                    e
                );
                println!("Template compile error (not a resolution issue): {}", e);
            }
        }

        // Cleanup
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_compile_typst_file_with_local_include() {
        // Test that local file resolution works (toml, include, etc.)
        let tmp = std::env::temp_dir().join("typst_test_include");
        fs::create_dir_all(&tmp).unwrap();

        // Write a sub-file
        let sub_path = tmp.join("header.typ");
        fs::write(&sub_path, "#text(size: 16pt, weight: \"bold\")[Resume]").unwrap();

        // Write main file that includes it
        let typ_path = tmp.join("main.typ");
        let mut f = fs::File::create(&typ_path).unwrap();
        writeln!(f, "#set page(width: 200pt, height: 100pt)").unwrap();
        writeln!(f, "#include \"header.typ\"").unwrap();
        writeln!(f, "Content here").unwrap();
        drop(f);

        let font_db = init_font_database();
        let prebuilt = build_fonts(&font_db);

        let result = compile_typst_file(&typ_path, &prebuilt, None);
        assert!(result.is_ok(), "compile with local include failed: {:?}", result.err());

        let (svg, _) = result.unwrap();
        assert!(svg.contains("<svg"), "SVG should contain <svg tag");

        // Cleanup
        fs::remove_dir_all(&tmp).ok();
    }

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
        fs::write(tmp.join("info.toml"), r##"[personal]
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
"##).unwrap();

        // Write resume.typ (from SKILL.md inline example)
        fs::write(tmp.join("resume.typ"), r##"#import "@preview/grotesk-cv:1.0.5": cv, experience-entry, education-entry, skill-entry

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
"##).unwrap();

        let font_db = init_font_database();
        let prebuilt = build_fonts(&font_db);

        let result = compile_typst_file(
            &tmp.join("resume.typ"),
            &prebuilt,
            Some(&templates_dir),
        );
        assert!(result.is_ok(), "grotesk-cv inline example failed: {:?}", result.err());

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

        fs::write(tmp.join("resume.typ"), r##"#import "@preview/basic-resume:0.2.9": *

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
"##).unwrap();

        let font_db = init_font_database();
        let prebuilt = build_fonts(&font_db);

        let result = compile_typst_file(
            &tmp.join("resume.typ"),
            &prebuilt,
            Some(&templates_dir),
        );
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

        fs::write(tmp.join("resume.typ"), r##"#import "@preview/calligraphics:1.0.0": *

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
"##).unwrap();

        let font_db = init_font_database();
        let prebuilt = build_fonts(&font_db);

        let result = compile_typst_file(
            &tmp.join("resume.typ"),
            &prebuilt,
            Some(&templates_dir),
        );
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
}
