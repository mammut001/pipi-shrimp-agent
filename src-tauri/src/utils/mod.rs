/**
 * Utils module
 *
 * Contains utility functions and error handling
 */

pub mod error;
pub mod typst;

pub use error::{AppError, AppResult};
pub use typst::{
    PrebuiltFonts,
    build_fonts,
    init_font_database,
    compile_typst_to_svg_with_prebuilt,
    compile_typst_to_pdf_with_prebuilt,
};
