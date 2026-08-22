# Backend

## Environment Variables

### ALLOWED_ORIGIN

When deploying to production via `wrangler deploy`, you must set `ALLOWED_ORIGIN` to the deployed frontend's real domain (e.g., `https://your-frontend-domain.com`). 
You can do this using `wrangler secret put ALLOWED_ORIGIN` or by updating the `[vars]` section in `wrangler.toml`.

For local development, this is set in `.dev.vars` and defaults to `http://localhost:5173`.
If you want to allow multiple origins, you can provide a comma-separated list of origins.
