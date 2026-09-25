use super::*;

#[test]
fn grounds_metric_tokens_from_source_text() {
    assert!(metric_appears_in_source(
        95.1,
        "The ResNet50 baseline reaches accuracy 95.1 on CIFAR10.",
    ));
    assert!(!metric_appears_in_source(
        99.9,
        "The ResNet50 baseline reaches accuracy 95.1 on CIFAR10.",
    ));
}

#[test]
fn renders_python_scaffold_with_required_files() {
    let vars = normalize_scaffold_vars(&json!({
        "projectName": "test-project",
        "researchGoal": "Improve test accuracy",
        "successCriteria": "Beat the baseline by at least 1 point.",
        "primaryMetric": "accuracy",
        "baselineName": "ResNet50",
        "datasetName": "CIFAR10",
        "trainCommand": "python3 train.py",
        "evalCommand": "python3 eval.py",
        "requirementsExtra": "torch",
    }));

    let rendered =
        render_known_scaffold_template("python-ml-baseline", "/tmp/test-project", &vars)
            .expect("render should succeed");

    assert!(rendered
        .rendered_files
        .iter()
        .any(|file| file.path == "run_experiment.py"));
    assert!(rendered
        .rendered_files
        .iter()
        .any(|file| file.path == "AUTORESEARCH.md"));
}
