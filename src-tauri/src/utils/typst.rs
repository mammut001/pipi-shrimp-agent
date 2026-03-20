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

/// Initialize font database with only Times New Roman (for faster startup).
/// TODO: In the future, add a font selection feature to allow users to choose their preferred fonts.
pub fn init_font_database() -> FontDatabase {
    let mut db = FontDatabase::new();
    
    // Try to load Times New Roman from common macOS locations
    let times_new_roman_paths = [
        "/Library/Fonts/Times New Roman.ttf",
        "/System/Library/Fonts/Times New Roman.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
        "~/Library/Fonts/Times New Roman.ttf",
    ];
    
    let mut loaded = false;
    for path in &times_new_roman_paths {
        let expanded_path = if path.starts_with("~") {
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
                loaded = true;
                break;
            }
        }
    }
    
    if !loaded {
        println!("⚠️ Times New Roman not found, falling back to system fonts");
        db.load_system_fonts();
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
pub use fontdb::Database as FontDb;
