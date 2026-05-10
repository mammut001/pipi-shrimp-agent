# AutoResearch local defaults

AutoResearch setup defaults come from `src/services/autoresearch/defaultConfig.ts`.

For shipped builds, the fallback config stays user-neutral:

- `workdir`: `~/autoresearch`
- `experimentDir`: `~/Documents/tiny-autoresearch-digits`
- `metric`: `cv_accuracy`
- `direction`: `higher`
- `iterations`: `5`

For local development, you can override these at build time with `.env` values:

```bash
AUTORESEARCH_DEFAULT_WORKDIR=~/autoresearch
AUTORESEARCH_DEFAULT_EXPERIMENT_DIR=/Users/yourname/Documents/tiny-autoresearch-digits
AUTORESEARCH_DEFAULT_METRIC=cv_accuracy
AUTORESEARCH_DEFAULT_DIRECTION=higher
AUTORESEARCH_DEFAULT_ITERATIONS=5
```

These overrides are injected by Vite and should only live in your uncommitted local `.env`.
