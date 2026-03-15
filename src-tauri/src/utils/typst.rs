/**
 * Typst utilities - Native in-memory rendering
 *
 * Implements typst::World trait for in-memory compilation
 * Uses fontdb for system font management
 */

use chrono::{Datelike, Timelike};
use comemo::Prehashed;
use fontdb::Database as FontDatabase;
use std::fs;
use typst::text::{Font, FontBook};
use typst::syntax::{FileId, Source};
use typst::World;
use typst::compile;
use typst_svg::svg;
use typst::foundations::{Bytes, Datetime};
use typst::Library;
use typst::diag::FileError;

/// Custom World implementation for in-memory Typst compilation
pub struct TypstWorld {
    /// The main source to compile
    source: Source,
    /// Font book containing available fonts
    book: Prehashed<FontBook>,
    /// Font data indexed by font ID
    fonts: Vec<Font>,
    /// The standard library
    library: Prehashed<Library>,
}

impl TypstWorld {
    /// Create a new TypstWorld with the given source and font database
    pub fn new(source_text: &str, font_db: &FontDatabase) -> Self {
        // Build font book from database
        let mut book = FontBook::new();
        let mut fonts = Vec::new();

        // Load each font from the database
        for face in font_db.faces() {
            // Get the font file path
            let path = match &face.source {
                fontdb::Source::File(path) => path.clone(),
                _ => continue, // Skip non-file sources
            };

            // Load font data from file
            let data = match fs::read(&path) {
                Ok(d) => d,
                Err(_) => continue,
            };

            // Convert to Bytes
            let bytes = Bytes::from(data);

            // Try to create a Font from the data
            if let Some(font) = Font::new(bytes, face.index) {
                book.push(font.info().clone());
                fonts.push(font);
            }
        }

        // Create source from the input text
        let source = Source::detached(source_text);

        // Build the standard library
        let library = Library::builder().build();

        Self {
            source,
            book: Prehashed::new(book),
            fonts,
            library: Prehashed::new(library),
        }
    }

    /// Compile the source to SVG and return the string
    pub fn compile_to_svg(&self) -> Result<String, String> {
        // Use typst::compile function
        let mut tracer = typst::eval::Tracer::new();
        let document = compile(self, &mut tracer)
            .map_err(|e| format!("Compilation failed: {:?}", e))?;

        // Convert each page to SVG and concatenate
        let mut svg_outputs = Vec::new();
        for page in &document.pages {
            let svg_output = svg(&page.frame);
            svg_outputs.push(svg_output);
        }

        Ok(svg_outputs.join("\n"))
    }
}

impl World for TypstWorld {
    /// Returns the standard library
    fn library(&self) -> &Prehashed<Library> {
        &self.library
    }

    /// Returns the font book
    fn book(&self) -> &Prehashed<FontBook> {
        &self.book
    }

    /// Returns the main source (entry point)
    fn main(&self) -> Source {
        self.source.clone()
    }

    /// Returns the source for a given FileId
    fn source(&self, _id: FileId) -> typst::diag::FileResult<Source> {
        // For simple single-file compilation, we only have the main source
        // Return error for other files
        Err(FileError::NotFound(std::path::PathBuf::new()))
    }

    /// Returns a file from the "file system"
    fn file(&self, _id: FileId) -> typst::diag::FileResult<Bytes> {
        // We don't support file imports in this simple implementation
        Err(FileError::NotFound(std::path::PathBuf::new()))
    }

    /// Returns a font by its index
    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    /// Returns today's date
    fn today(&self, _offset: Option<i64>) -> Option<Datetime> {
        // Return current date
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

/// Initialize font database with system fonts
pub fn init_font_database() -> FontDatabase {
    let mut db = FontDatabase::new();
    db.load_system_fonts();
    db
}

/// Create a font database and load system fonts
/// This is a convenience function for quick setup
pub fn create_font_db() -> FontDatabase {
    let mut db = FontDatabase::new();
    db.load_system_fonts();
    db
}

/**
 * Compile Typst source to SVG string
 *
 * This is the main entry point for the Tauri command.
 * It creates a fresh font database each time - for production,
 * you should reuse a cached font database from State.
 */
pub fn compile_typst_to_svg(source: &str) -> Result<String, String> {
    let font_db = create_font_db();
    let world = TypstWorld::new(source, &font_db);
    world.compile_to_svg()
}

/**
 * Compile Typst source to SVG using a shared font database (for State)
 */
pub fn compile_typst_to_svg_with_fonts(source: &str, font_db: &FontDatabase) -> Result<String, String> {
    let world = TypstWorld::new(source, font_db);
    world.compile_to_svg()
}

/**
 * Check if font loading works (diagnostic function)
 */
pub fn check_font_availability() -> usize {
    let db = create_font_db();
    db.faces().count()
}

/// Re-export FontDatabase for use in State
pub use fontdb::Database as FontDb;
