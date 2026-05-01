use crate::utils::{
    compile_typst_to_pdf_with_prebuilt, compile_typst_to_svg_with_prebuilt, PrebuiltFonts,
};

/// Pre-built font state (initialized once at startup).
/// Fonts are Arc-wrapped internally, so cloning for each render is O(n) but free of disk I/O.
pub struct FontDbState {
    pub prebuilt: PrebuiltFonts,
}

/// Render Typst source to SVG.
#[tauri::command]
pub async fn render_typst_to_svg(
    source: String,
    font_state: tauri::State<'_, FontDbState>,
) -> Result<String, String> {
    let book = font_state.prebuilt.book.clone();
    let fonts = font_state.prebuilt.fonts.clone();

    tokio::task::spawn_blocking(move || {
        let prebuilt = PrebuiltFonts { book, fonts };
        compile_typst_to_svg_with_prebuilt(&source, &prebuilt)
    })
    .await
    .map_err(|e| format!("Thread error: {}", e))?
}

/// Render Typst source to PDF and save to file.
#[tauri::command]
pub async fn render_typst_to_pdf(
    source: String,
    file_path: String,
    font_state: tauri::State<'_, FontDbState>,
) -> Result<String, String> {
    let book = font_state.prebuilt.book.clone();
    let fonts = font_state.prebuilt.fonts.clone();

    let pdf_bytes = tokio::task::spawn_blocking(move || {
        let prebuilt = PrebuiltFonts { book, fonts };
        compile_typst_to_pdf_with_prebuilt(&source, &prebuilt)
    })
    .await
    .map_err(|e| format!("Thread error: {}", e))??;

    std::fs::write(&file_path, pdf_bytes).map_err(|e| format!("Failed to write PDF: {}", e))?;

    Ok(file_path)
}

/// Check how many fonts are available (diagnostic).
#[tauri::command]
pub fn get_font_count(font_state: tauri::State<'_, FontDbState>) -> usize {
    font_state.prebuilt.fonts.len()
}
