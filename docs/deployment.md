# Deployment

Heliozoa is static files. There is no build step, no bundler, and no server
component — `public/` is the whole site.

Live at [helioza.eamann.com](https://helioza.eamann.com).

## Cloudflare Pages, through the dashboard

The Git integration is the path worth using: every push deploys, and every
branch gets its own preview URL.

1. In the Cloudflare dashboard, go to **Workers & Pages**, then
   **Create** → **Pages** → **Connect to Git**, and pick the repository.
2. Settings:

   | Field | Value |
   | --- | --- |
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | *leave empty* |
   | Build output directory | `public` |
   | Root directory | `/` |

3. Save and deploy.

There is nothing to install and nothing to compile, so the build finishes in
seconds. If Cloudflare offers to run `npm install`, decline — the dev
dependencies are for tests, and the site does not need them.

## Cloudflare Pages, from the command line

```
npx wrangler pages deploy public --project-name helioza
```

The first run creates the project and asks which branch it should treat as
production. Use this for a one-off deploy or from CI; the dashboard integration
is better for ongoing work because it handles previews automatically.

## Preview deployments

Every branch and every pull request gets its own URL under the project's
`pages.dev` domain:

- production: `helioza.pages.dev`
- a branch: `<branch>.helioza.pages.dev`
- a specific deployment: `<commit-hash>.helioza.pages.dev`

Branch names are normalised — slashes and underscores become hyphens — so
`feature/new-gene` lands at `feature-new-gene.helioza.pages.dev`.

## The custom domain

`helioza.eamann.com` points at the project.

1. Open the Pages project, go to **Custom domains**, and **Set up a custom
   domain**. Enter `helioza.eamann.com`.
2. Cloudflare checks whether it manages the zone. `eamann.com` is on Cloudflare,
   so it creates the `CNAME` record itself — `helioza` → `helioza.pages.dev`,
   proxied — and issues the certificate. There is nothing to add by hand.
3. Wait for the domain to move from **Initializing** to **Active**. It is
   usually under a minute, occasionally a few.

If the zone were hosted elsewhere, the record would have to be added manually in
that provider's DNS:

```
helioza   CNAME   helioza.pages.dev
```

and Cloudflare would wait to see it before issuing a certificate.

## Anywhere else

Any static host works. Point it at `public/` and serve the files. The only
requirements are that `.js` files are served with a JavaScript MIME type — ES
modules are rejected outright if they arrive as `text/plain` — and that the host
does not rewrite paths, since `index.html` loads `js/main.js` relative to itself.

GitHub Pages, Netlify, S3 behind CloudFront, or `python3 -m http.server` on a
laptop will all serve it correctly.
