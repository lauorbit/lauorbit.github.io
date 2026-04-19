// Runtime configuration for browser-side Typesense search.
// This file currently points at a local Typesense instance on localhost:8108.
// For a deployed public site, replace the node host with your public Typesense host.
// GitHub Pages is served over HTTPS, so your Typesense host must also be reachable over HTTPS.
globalThis.ORBIT_SITE_SEARCH_CONFIG = {
    enabled: true,
    collectionName: "orbit_journals",
    apiKey: "cXEH33brTYECgYutHSsQ8RQ8qU-aDsv9",
    nodes: [
        {
            host: "localhost",
            port: "8108",
            protocol: "http",
            path: "",
        },
    ],
    connectionTimeoutSeconds: 5,
    searchParameters: {
        query_by: "primary_title,title_variants,issns,compact_issns",
        query_by_weights: "12,10,12,12",
        prioritize_exact_match: true,
        prefix: true,
        num_typos: 2,
        sort_by: "_text_match:desc,grade_score:desc,uncertainty:asc",
        per_page: 50,
    },
};
