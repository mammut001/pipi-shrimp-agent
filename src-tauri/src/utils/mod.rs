/**
 * Utils module
 *
 * Contains utility functions and error handling
 */
pub mod error;
pub mod token;
pub mod typst;

pub use error::{AppError, AppResult};
pub use typst::{
    build_fonts, compile_typst_to_pdf_with_prebuilt, compile_typst_to_svg_with_prebuilt,
    init_font_database, PrebuiltFonts,
};
