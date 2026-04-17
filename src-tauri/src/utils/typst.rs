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
 */

use chrono::{Datelike, Timelike};
use comemo::Prehashed;
use fontdb::Database as FontDatabase;
use std::fs;
use typst::text::{Font, FontBook};
use typst::syntax::{FileId, Source};
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
pub struct TypstWorld {
    source: Source,
    book: Prehashed<FontBook>,
    fonts: Vec<Font>,
    library: Prehashed<Library>,
}

impl TypstWorld {
    /// Create a world using pre-built fonts (cheap — only Arc clones, no disk I/O).
    pub fn new_with_prebuilt(source_text: &str, prebuilt: &PrebuiltFonts) -> Self {
        Self {
            source: Source::detached(source_text),
            // Cloning Prehashed<FontBook> clones the Arc inside — O(1)
            book: prebuilt.book.clone(),
            // Cloning Vec<Font> clones each Font's inner Arc — O(n) but allocation-free
            fonts: prebuilt.fonts.clone(),
            library: Prehashed::new(Library::builder().build()),
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

    fn source(&self, _id: FileId) -> typst::diag::FileResult<Source> {
        Err(FileError::NotFound(std::path::PathBuf::new()))
    }

    fn file(&self, _id: FileId) -> typst::diag::FileResult<Bytes> {
        Err(FileError::NotFound(std::path::PathBuf::new()))
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

/// Re-export for use in State.
#[allow(unused_imports)]
pub use fontdb::Database as FontDb;
