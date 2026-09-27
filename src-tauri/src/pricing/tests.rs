use super::*;

const CATALOG: &str = r#"{
  "data": [
    {
      "id": "anthropic/claude-haiku-4.5",
      "name": "Anthropic: Claude Haiku 4.5",
      "canonical_slug": "anthropic/claude-4.5-haiku-20251001",
      "context_length": 200000,
      "pricing": {
        "prompt": "0.000001",
        "completion": "0.000005",
        "input_cache_read": "0.0000001",
        "input_cache_write": "0.00000125"
      }
    },
    {
      "id": "deepseek/deepseek-v4-flash",
      "name": "  ",
      "pricing": { "prompt": "0.000000088606", "completion": "0.000000177212" }
    },
    {
      "id": "openrouter/auto",
      "pricing": { "prompt": "-1", "completion": "-1" }
    },
    {
      "id": "meta/free-model:free",
      "pricing": { "prompt": "0", "completion": "0" }
    },
    { "id": "no/pricing" }
  ]
}"#;

fn parse(previous: Option<&PricingTable>) -> PricingTable {
    parse_openrouter_catalog(CATALOG, previous, "2026-09-27 10:00:00+0000".to_string())
        .expect("catalog parses")
}

#[test]
fn converts_per_token_prices_to_per_million() {
    let table = parse(None);
    let haiku = &table.models["anthropic/claude-haiku-4.5"];
    assert_eq!(haiku.input, 1.0);
    assert_eq!(haiku.output, 5.0);
    assert_eq!(haiku.cache_read, 0.1);
    assert_eq!(haiku.cache_write, 1.25);
    assert_eq!(haiku.context_length, Some(200000));
    assert_eq!(
        haiku.canonical_slug.as_deref(),
        Some("anthropic/claude-4.5-haiku-20251001")
    );

    let deepseek = &table.models["deepseek/deepseek-v4-flash"];
    assert_eq!(deepseek.input, 0.088606);
    assert_eq!(deepseek.output, 0.177212);
    assert_eq!(deepseek.name, None, "blank names are dropped");
}

#[test]
fn skips_free_placeholder_and_unpriced_models() {
    let table = parse(None);
    assert_eq!(
        table.models.keys().cloned().collect::<Vec<_>>(),
        vec!["anthropic/claude-haiku-4.5", "deepseek/deepseek-v4-flash"]
    );
    assert_eq!(table.meta.active_count, 2);
    assert_eq!(table.meta.retained_count, 0);
    assert_eq!(table.meta.count, 2);
}

#[test]
fn keeps_models_that_left_the_catalog_as_retired() {
    let mut previous = parse(None);
    previous.models.insert(
        "anthropic/claude-3-opus".to_string(),
        ModelPrice {
            input: 15.0,
            output: 75.0,
            cache_read: 1.5,
            cache_write: 18.75,
            name: None,
            canonical_slug: None,
            context_length: None,
            retired: false,
        },
    );

    let table = parse(Some(&previous));
    let retired = &table.models["anthropic/claude-3-opus"];
    assert!(retired.retired);
    assert_eq!(retired.input, 15.0);
    assert!(!table.models["anthropic/claude-haiku-4.5"].retired);
    assert_eq!(table.meta.active_count, 2);
    assert_eq!(table.meta.retained_count, 1);
    assert_eq!(table.meta.count, 3);
}

#[test]
fn rejects_malformed_or_empty_catalogs() {
    assert!(parse_openrouter_catalog("not json", None, String::new()).is_err());
    assert!(parse_openrouter_catalog(r#"{"data": []}"#, None, String::new()).is_err());
}

#[test]
fn bundled_snapshot_is_valid_and_tokei_compatible() {
    let table = bundled_snapshot();
    assert!(table.models.len() > 100);
    let sonnet = &table.models["anthropic/claude-sonnet-5"];
    assert_eq!((sonnet.input, sonnet.output), (2.0, 10.0));

    // Round-trips through the same on-disk format tokei writes.
    let json = serde_json::to_string(&table).unwrap();
    assert!(json.contains("\"_meta\""));
    assert!(json.contains("\"in\":"));
    assert_eq!(serde_json::from_str::<PricingTable>(&json).unwrap(), table);
}

#[test]
fn load_falls_back_to_snapshot_and_reads_saved_tables() {
    let dir = std::env::temp_dir().join(format!("pipi-pricing-{}", uuid::Uuid::new_v4()));
    let path = dir.join("model_pricing.json");

    assert_eq!(load_pricing_table_from(&path), bundled_snapshot());

    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(&path, "{ truncated").unwrap();
    assert_eq!(load_pricing_table_from(&path), bundled_snapshot());

    let table = parse(None);
    save_pricing_table_to(&path, &table).unwrap();
    assert_eq!(load_pricing_table_from(&path), table);
    assert!(!path.with_extension("json.tmp").exists());

    std::fs::remove_dir_all(&dir).unwrap();
}
