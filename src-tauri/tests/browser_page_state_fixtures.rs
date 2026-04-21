use pipi_shrimp_agent::browser::dom::{build_page_state_from_snapshot, CapturedPageSnapshot};

fn load_fixture(name: &str) -> CapturedPageSnapshot {
    let raw = match name {
        "iframe-shadow" => include_str!("fixtures/browser-page-state-iframe-shadow.json"),
        "iframe-retry-cache" => include_str!("fixtures/browser-page-state-iframe-retry-cache.json"),
        "navigation-refresh" => include_str!("fixtures/browser-page-state-navigation-refresh.json"),
        "partial-warnings" => include_str!("fixtures/browser-page-state-partial-warnings.json"),
        other => panic!("unknown fixture: {}", other),
    };

    serde_json::from_str(raw).expect("fixture should deserialize into CapturedPageSnapshot")
}

#[test]
fn preserves_iframe_and_open_shadow_dom_elements_from_fixture() {
    let page_state = build_page_state_from_snapshot(load_fixture("iframe-shadow"));

    assert_eq!(page_state.frame_count, 2);
    assert!(page_state.warnings.is_empty());

    let shadow_button = page_state
        .find_element_by_backend_node_id(200)
        .expect("shadow root button should remain actionable");
    assert_eq!(shadow_button.name, "Confirm Order");
    assert_eq!(shadow_button.frame_id, "root");

    let iframe_input = page_state
        .find_element_by_backend_node_id(310)
        .expect("iframe input should remain addressable");
    assert_eq!(iframe_input.role, "textbox");
    assert_eq!(iframe_input.frame_id, "frame-checkout");
    assert_eq!(iframe_input.selector_hint.as_deref(), Some("#card-number"));
}

#[test]
fn preserves_partial_iframe_and_closed_shadow_dom_warnings_from_fixture() {
    let page_state = build_page_state_from_snapshot(load_fixture("partial-warnings"));

    assert_eq!(page_state.frame_count, 1);
    assert!(page_state
        .warnings
        .contains(&"cross_origin_iframe_partial".to_string()));
    assert!(page_state
        .warnings
        .contains(&"closed_shadow_root_partial".to_string()));

    let root_button = page_state
        .find_element_by_backend_node_id(120)
        .expect("root-frame controls should still be available when partial warnings exist");
    assert_eq!(root_button.name, "Open Support");
    assert!(root_button.is_clickable);
}

#[test]
fn preserves_partial_same_navigation_iframe_retry_fixture() {
    let page_state = build_page_state_from_snapshot(load_fixture("iframe-retry-cache"));

    assert_eq!(page_state.frame_count, 2);
    assert_eq!(page_state.navigation_id, "loader-root-1");
    assert!(page_state
        .warnings
        .contains(&"cross_origin_iframe_partial".to_string()));
    assert!(page_state.find_element_by_backend_node_id(310).is_none());

    let shadow_button = page_state
        .find_element_by_backend_node_id(200)
        .expect("root-frame fallback controls should still be present in partial iframe captures");
    assert_eq!(shadow_button.frame_id, "root");
}

#[test]
fn preserves_navigation_refresh_fixture_with_updated_navigation_id() {
    let page_state = build_page_state_from_snapshot(load_fixture("navigation-refresh"));

    assert_eq!(page_state.navigation_id, "loader-root-2");
    assert_eq!(page_state.title, "Review Order");

    let iframe_input = page_state
        .find_element_by_backend_node_id(310)
        .expect("iframe input should remain addressable after navigation refresh");
    assert_eq!(iframe_input.frame_id, "frame-checkout");
    assert!(iframe_input.is_editable);
}