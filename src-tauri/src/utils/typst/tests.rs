//! Unit tests for typst.rs moved verbatim out of typst.rs.

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
    assert!(
        result.is_ok(),
        "compile with local include failed: {:?}",
        result.err()
    );

    let (svg, _) = result.unwrap();
    assert!(svg.contains("<svg"), "SVG should contain <svg tag");

    // Cleanup
    fs::remove_dir_all(&tmp).ok();
}

mod template_examples;
