# Typesense Setup

This site now supports journal search through a Typesense collection, with an automatic fallback to the existing in-browser search when Typesense is not configured.

## Current local setup

Typesense is installed locally on this machine via Homebrew and is configured at:

- `/opt/homebrew/etc/typesense/typesense.ini`

The site is currently configured to use:

- Host: `localhost`
- Port: `8108`
- Collection: `orbit_journals`

Local credentials used for setup are stored outside the web root at:

- `/Users/sergio/Desktop/ORBITUpdate/.typesense/orbit-local-credentials.json`

Important:

- The frontend now contains a public search-only key, which is expected for a public-search setup.
- The current host is still local-only. If you deploy the static site publicly, replace `localhost` in `orbit-site-search-config.js` with a publicly reachable Typesense host.
- If you host the site on GitHub Pages, the Typesense node must be reachable over `https`, not `http`, or browsers will block the requests as mixed content.
- Never copy the bootstrap admin key into any browser-served file.

## Generated artifacts

Run the dataset builder to refresh both the site dataset and the Typesense import files:

```bash
python3 /Users/sergio/Desktop/ORBITUpdate/UpdatedWebsite17April/tools/build_site_dataset.py
```

That command writes:

- `/Users/sergio/Desktop/ORBITUpdate/UpdatedWebsite17April/data/orbit-site-meta.js`
- `/Users/sergio/Desktop/ORBITUpdate/UpdatedWebsite17April/data/orbit-site-records.js`
- `/Users/sergio/Desktop/ORBITUpdate/UpdatedWebsite17April/data/orbit-typesense-schema.json`
- `/Users/sergio/Desktop/ORBITUpdate/UpdatedWebsite17April/data/orbit-typesense-documents.jsonl`

## Create the collection

Use a Typesense admin key on the server side to create the collection:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-TYPESENSE-API-KEY: ${TYPESENSE_ADMIN_API_KEY}" \
  --data @/Users/sergio/Desktop/ORBITUpdate/UpdatedWebsite17April/data/orbit-typesense-schema.json \
  "${TYPESENSE_PROTOCOL}://${TYPESENSE_HOST}:${TYPESENSE_PORT}/collections"
```

## Import or update documents

Bulk import the generated JSONL file:

```bash
curl -X POST \
  -H "Content-Type: text/plain" \
  -H "X-TYPESENSE-API-KEY: ${TYPESENSE_ADMIN_API_KEY}" \
  --data-binary @/Users/sergio/Desktop/ORBITUpdate/UpdatedWebsite17April/data/orbit-typesense-documents.jsonl \
  "${TYPESENSE_PROTOCOL}://${TYPESENSE_HOST}:${TYPESENSE_PORT}/collections/orbit_journals/documents/import?action=upsert"
```

## Front-end configuration

Update `/Users/sergio/Desktop/ORBITUpdate/UpdatedWebsite17April/data/orbit-site-search-config.js` if you move from local development to a deployed instance:

1. Set `enabled` to `true`.
2. Replace `nodes` with your Typesense node details.
3. Set `apiKey` to a search-only key for the `orbit_journals` collection.

Do not expose an admin key in the browser. The front-end file should only contain a search-only key scoped to `documents:search`.

## Current behavior

- Journal search uses Typesense when the runtime config is enabled and valid.
- Filter search also uses Typesense when available.
- If Typesense is unreachable or misconfigured, journal search falls back to the local dataset automatically.
- If Typesense is unreachable or misconfigured, filter search also falls back to the local dataset automatically.
