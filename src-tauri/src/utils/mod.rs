/**
 * Utils module
 *
 * Contains utility functions and error handling
 */

pub mod error;
pub mod typst;

pub use error::{AppError, AppResult};
pub use typst::{
    compile_typst_to_svg,
    compile_typst_to_svg_with_fonts,
    init_font_database,
    check_font_availability,
    FontDb,
};
