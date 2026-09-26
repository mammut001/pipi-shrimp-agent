use super::{register_bootstrap_tool, ToolRegistry};

pub(super) fn register_bootstrap_tools(registry: &mut ToolRegistry) {
    register_bootstrap_tool(
        registry,
        "pdf_read",
        "Read and extract plain text from a local PDF file path.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" }
            },
            "required": ["path"],
            "additionalProperties": false,
        }),
        true,
        true,
    );
    register_bootstrap_tool(
        registry,
        "paper_extract_meta",
        "Extract structured paper metadata from grounded source text. Return JSON-only metadata.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "text": { "type": "string" }
            },
            "required": ["text"],
            "additionalProperties": false,
        }),
        true,
        true,
    );
    register_bootstrap_tool(
        registry,
        "baseline_extract",
        "Extract baseline methods and reported metrics from grounded paper text. Return JSON-only baselines.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "text": { "type": "string" }
            },
            "required": ["text"],
            "additionalProperties": false,
        }),
        true,
        true,
    );
    register_bootstrap_tool(
        registry,
        "arxiv_search",
        "Search arXiv and return a small list of relevant paper metadata.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string" },
                "limit": { "type": "number" }
            },
            "required": ["query"],
            "additionalProperties": false,
        }),
        true,
        true,
    );
    register_bootstrap_tool(
        registry,
        "scaffold_generate",
        "Generate a deterministic AutoResearch scaffold into the requested workDir using a known template.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "templateId": { "type": "string", "enum": ["python-ml-baseline", "node-eval-harness"] },
                "workDir": { "type": "string" },
                "researchGoal": { "type": "string" },
                "successCriteria": { "type": "string" },
                "primaryMetric": { "type": "string" },
                "baselineName": { "type": "string" },
                "datasetName": { "type": "string" },
                "projectName": { "type": "string" },
                "overwriteExisting": { "type": "boolean" }
            },
            "required": ["templateId", "workDir", "researchGoal", "successCriteria", "primaryMetric"],
            "additionalProperties": false,
        }),
        false,
        false,
    );
    register_bootstrap_tool(
        registry,
        "git_init_workdir",
        "Initialize a Git repository in the specified workDir and create the initial commit.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "workDir": { "type": "string" }
            },
            "required": ["workDir"],
            "additionalProperties": false,
        }),
        false,
        false,
    );
    register_bootstrap_tool(
        registry,
        "bootstrap_finalize",
        "Validate and persist the final AutoResearch bootstrap plan. Returns a structured bootstrap result.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "researchGoal": { "type": "string" },
                "successCriteria": { "type": "string" },
                "primaryMetric": { "type": "string" },
                "secondaryMetrics": { "type": "array", "items": { "type": "string" } },
                "papers": { "type": "array", "items": { "type": "object" } },
                "baselines": { "type": "array", "items": { "type": "object" } },
                "scaffold": { "type": "object" },
                "gitInitialized": { "type": "boolean" },
                "initialCommitSha": { "type": "string" },
                "conversationalTemplateId": { "type": "string", "enum": ["reproduce-paper", "beat-baseline", "ablation", "from-scratch"] }
            },
            "required": ["researchGoal", "successCriteria", "primaryMetric", "papers", "baselines", "scaffold", "gitInitialized", "conversationalTemplateId"],
            "additionalProperties": false,
        }),
        false,
        false,
    );


}
