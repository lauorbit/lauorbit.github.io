(function () {
    const payload = globalThis.ORBIT_SITE_META;
    if (!payload || !payload.recordsScriptUrl) {
        throw new Error("ORBIT site metadata is missing.");
    }

    const ROW = {
        title: 0,
        issns: 1,
        urls: 2,
        publisher: 3,
        asjcCodes: 4,
        flags: 5,
        ratings: 6,
        openAccess: 7,
        grade: 8,
        uncertainty: 9,
    };

    const FLAGS = payload.flagBits;
    const RESULTS_PER_PAGE = 50;
    const DEFAULT_TYPESENSE_SEARCH_PARAMETERS = {
        query_by: "primary_title,title_variants,issns,compact_issns",
        query_by_weights: "12,10,12,12",
        prioritize_exact_match: true,
        prefix: true,
        num_typos: 2,
        sort_by: "_text_match:desc,grade_score:desc,uncertainty:asc",
        per_page: RESULTS_PER_PAGE,
    };
    const GRADE_ORDER = ["A+", "A", "B", "C", "D", "Unranked"];
    const GRADE_SCORE = {
        "A+": 5,
        "A": 4,
        "B": 3,
        "C": 2,
        "D": 1,
        "Unranked": 0,
    };
    const GRADE_MEANINGS = {
        "A+": "Represents journals of the highest tier, either by achieving a top percentile score or by being on the consolidated Elite List. Indicates universal recognition as a leading journal.",
        "A": "Denotes journals of excellent quality that fall just below the elite tier. These are highly regarded publications with a strong consensus.",
        "B": "Represents the broad, central tier of reputable and recognized academic journals. The majority of journals fall into this category.",
        "C": "Indicates journals that are recognized but fall below the median quality level of the overall academic landscape.",
        "D": "Represents journals of the lowest tier, either by falling in the bottom percentile or by being on the warning list. This grade suggests significant quality or integrity concerns.",
    };
    const RATING_DISPLAY_NAMES = {
        "ABDC": "ABDC 2025",
        "JUFO": "JUFO Level",
        "AJG": "AJG 2024",
        "FNEGE": "FNEGE 2025",
        "VHB": "VHB 2024",
        "Norwegian": "Norwegian Level",
    };

    const elements = {
        tabContainer: document.getElementById("tab-container"),
        journalInput: document.getElementById("journal-input"),
        clearSearchBtn: document.getElementById("clear-search-btn"),
        filterBtn: document.getElementById("filter-btn"),
        resetBtn: document.getElementById("reset-btn"),
        resultsContainer: document.getElementById("results-container"),
        paginationContainer: document.getElementById("pagination-container"),
        rankSelect: document.getElementById("rank-select"),
        asjcSelect: document.getElementById("asjc-select"),
        publisherSelect: document.getElementById("publisher-select"),
        openAccessSelect: document.getElementById("open-access-select"),
        sortSelect: document.getElementById("sort-select"),
        tabJournalSearch: document.getElementById("tab-journal-search"),
        tabFilterSearch: document.getElementById("tab-filter-search"),
        tabAbout: document.getElementById("tab-about"),
        tabFaq: document.getElementById("tab-faq"),
        tabContact: document.getElementById("tab-contact"),
        panelJournalSearch: document.getElementById("panel-journal-search"),
        panelFilterSearch: document.getElementById("panel-filter-search"),
        panelAbout: document.getElementById("panel-about"),
        panelFaq: document.getElementById("panel-faq"),
        panelContact: document.getElementById("panel-contact"),
        aboutGradeTableBody: document.getElementById("about-grade-table-body"),
        aboutSummaryStats: document.getElementById("about-summary-stats"),
        rankingDistributionChart: document.getElementById("ranking-distribution-chart"),
        faqJournalsMethodology: document.getElementById("faq-journals-methodology"),
        faqJournalsUsage: document.getElementById("faq-journals-usage"),
    };

    const state = {
        activeTab: "journal",
        activeMode: "journal",
        currentResults: [],
        currentOffset: 0,
        aboutReady: false,
        records: null,
        recordsPromise: null,
        currentResultsTotal: 0,
        loadMoreResults: null,
        selectsReady: false,
        tomSelect: {},
        typesenseResolved: false,
        typesenseClient: null,
        typesenseConfig: null,
        journalSearchDebounceId: null,
        journalSearchRequestToken: 0,
    };

    function splitPipeValues(value) {
        return String(value || "")
            .split("|")
            .map((part) => part.replace(/\s+/g, " ").trim().replace(/;+$/, ""))
            .filter(Boolean)
            .filter((part, index, array) => array.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index);
    }

    function normalizeText(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/&/g, " and ")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function compactIssn(value) {
        return String(value || "").replace(/[^0-9xX]+/g, "").toUpperCase();
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString("en-US");
    }

    function formatDisplayValue(value) {
        if (value === undefined || value === null) {
            return "N/A";
        }
        if (Array.isArray(value)) {
            const cleaned = value.map((item) => String(item || "").trim()).filter(Boolean);
            return cleaned.length ? cleaned.join(" | ") : "N/A";
        }
        const text = String(value).trim();
        return text ? text : "N/A";
    }

    function toDisplayTitleCase(value) {
        if (!value || typeof value !== "string") {
            return "";
        }

        const smallWords = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "in", "on", "at", "to", "of", "by", "from", "with", "as"]);
        return value.split(/\s+/).map((word, index, words) => {
            if (!word) {
                return word;
            }

            const cleanWord = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
            const isAllCaps = cleanWord.length > 1 && /[A-Z]/.test(cleanWord) && cleanWord === cleanWord.toUpperCase();
            if (isAllCaps) {
                return word;
            }

            const lowerWord = word.toLowerCase();
            if (index !== 0 && index !== words.length - 1 && smallWords.has(lowerWord)) {
                return lowerWord;
            }

            return lowerWord.replace(/\b([a-z])([a-z']*)/g, (match, first, rest) => first.toUpperCase() + rest);
        }).join(" ");
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function gradeValue(grade) {
        return GRADE_SCORE[grade] ?? 0;
    }

    function isOpenAccess(record) {
        return (record.flags & FLAGS.openAccess) === FLAGS.openAccess;
    }

    function infoIcon(message) {
        return `<svg class="info-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" onclick='window.showInfoModal(${JSON.stringify(message)})'><path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" /></svg>`;
    }

    function externalLinkIcon() {
        return '<svg class="link-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-4.5 0V6.375c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A2.25 2.25 0 0110.5 10.5v-4.5a2.25 2.25 0 012.25-2.25H15M10.5 15L15 10.5" /></svg>';
    }

    function showInfoModal(message) {
        const modalOverlay = document.createElement("div");
        modalOverlay.className = "modal-overlay";
        modalOverlay.innerHTML = `
            <div class="modal-content">
                <span class="modal-close">&times;</span>
                <p>${escapeHtml(message)}</p>
            </div>
        `;
        document.body.appendChild(modalOverlay);
        modalOverlay.querySelector(".modal-close").addEventListener("click", () => modalOverlay.remove());
        modalOverlay.addEventListener("click", (event) => {
            if (event.target === modalOverlay) {
                modalOverlay.remove();
            }
        });
    }

    globalThis.showInfoModal = showInfoModal;

    function loadScriptOnce(src) {
        return new Promise((resolve, reject) => {
            const selector = `script[data-orbit-src="${src}"]`;
            const existing = document.querySelector(selector);
            if (existing) {
                if (existing.dataset.loaded === "true") {
                    resolve();
                    return;
                }
                if (existing.dataset.error === "true") {
                    existing.remove();
                } else {
                    existing.addEventListener("load", () => resolve(), { once: true });
                    existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
                    return;
                }
            }

            const script = document.createElement("script");
            script.src = src;
            script.async = true;
            script.dataset.orbitSrc = src;
            script.addEventListener("load", () => {
                script.dataset.loaded = "true";
                resolve();
            }, { once: true });
            script.addEventListener("error", () => {
                script.dataset.error = "true";
                reject(new Error(`Failed to load ${src}`));
            }, { once: true });
            document.head.appendChild(script);
        });
    }

    function buildRecord(row, index) {
        const titleVariants = splitPipeValues(row[ROW.title]);
        const publishers = splitPipeValues(row[ROW.publisher]);
        const issns = Array.isArray(row[ROW.issns]) ? row[ROW.issns] : [];
        const urls = Array.isArray(row[ROW.urls]) ? row[ROW.urls] : [];
        const asjcCodes = Array.isArray(row[ROW.asjcCodes]) ? row[ROW.asjcCodes] : [];
        const ratings = Array.isArray(row[ROW.ratings]) ? row[ROW.ratings] : [];
        const ratingsMap = {};

        payload.ratingLabels.forEach((label, labelIndex) => {
            ratingsMap[label] = ratings[labelIndex] || "";
        });

        return {
            id: index,
            titleVariants,
            primaryTitle: titleVariants[0] || "Untitled entry",
            displayTitle: toDisplayTitleCase(titleVariants[0] || "Untitled entry"),
            normalizedTitle: normalizeText(titleVariants.join(" ")),
            issns,
            compactIssns: issns.map(compactIssn),
            urls,
            publishers,
            publisherDisplay: publishers.join(" | "),
            asjcCodes,
            flags: row[ROW.flags] || 0,
            ratings,
            ratingsMap,
            openAccessLabel: row[ROW.openAccess] || "",
            grade: row[ROW.grade] || "Unranked",
            uncertainty: typeof row[ROW.uncertainty] === "number" ? row[ROW.uncertainty] : Number(row[ROW.uncertainty] || 0),
        };
    }

    function toStringArray(value) {
        if (Array.isArray(value)) {
            return value
                .map((item) => String(item || "").trim())
                .filter(Boolean);
        }
        if (typeof value === "string") {
            return splitPipeValues(value);
        }
        return [];
    }

    function buildRecordFromSearchDocument(document) {
        if (!document || typeof document !== "object") {
            return null;
        }

        const titleVariants = toStringArray(document.title_variants);
        const primaryTitle = String(document.primary_title || titleVariants[0] || "Untitled entry").trim() || "Untitled entry";
        const publishers = toStringArray(document.publishers);
        const issns = toStringArray(document.issns);
        const compactIssns = toStringArray(document.compact_issns);
        const urls = toStringArray(document.urls);
        const asjcCodes = toStringArray(document.asjc_codes);
        const ratingsMap = {
            ABDC: String(document.rating_abdc || ""),
            JUFO: String(document.rating_jufo || ""),
            AJG: String(document.rating_ajg || ""),
            FNEGE: String(document.rating_fnege || ""),
            VHB: String(document.rating_vhb || ""),
            Norwegian: String(document.rating_norwegian || ""),
        };

        return {
            id: document.id ?? primaryTitle,
            titleVariants: titleVariants.length ? titleVariants : [primaryTitle],
            primaryTitle,
            displayTitle: toDisplayTitleCase(primaryTitle),
            normalizedTitle: normalizeText([primaryTitle, ...titleVariants].join(" ")),
            issns,
            compactIssns: compactIssns.length ? compactIssns : issns.map(compactIssn),
            urls,
            publishers,
            publisherDisplay: String(document.publisher_display || publishers.join(" | ")),
            asjcCodes,
            flags: Number(document.flags || 0),
            ratings: payload.ratingLabels.map((label) => ratingsMap[label] || ""),
            ratingsMap,
            openAccessLabel: String(document.open_access_label || ""),
            grade: String(document.grade || "Unranked") || "Unranked",
            uncertainty: Number.isFinite(Number(document.uncertainty)) ? Number(document.uncertainty) : 0,
        };
    }

    function getTypesenseSearchConfig() {
        const config = globalThis.ORBIT_SITE_SEARCH_CONFIG;
        if (!config || config.enabled !== true) {
            return null;
        }

        const collectionName = String(config.collectionName || "").trim();
        const apiKey = String(config.apiKey || "").trim();
        const nodes = Array.isArray(config.nodes)
            ? config.nodes
                .map((node) => ({
                    host: String(node && node.host || "").trim(),
                    port: String(node && node.port || "").trim(),
                    protocol: String(node && node.protocol || "").trim(),
                    path: String(node && node.path || "").trim(),
                }))
                .filter((node) => node.host && node.port && node.protocol)
            : [];

        if (!collectionName || !apiKey || !nodes.length) {
            console.warn("Typesense search is enabled but missing required configuration.");
            return null;
        }

        const pageProtocol = String(window.location && window.location.protocol || "").toLowerCase();
        const pageHostname = String(window.location && window.location.hostname || "").toLowerCase();
        const isLocalPage = ["localhost", "127.0.0.1", "::1"].includes(pageHostname);
        const hasMixedContentNode = pageProtocol === "https:" && nodes.some((node) => node.protocol.toLowerCase() !== "https");
        if (hasMixedContentNode) {
            console.warn("Typesense search is enabled with a non-HTTPS node on an HTTPS page. Falling back to local search.");
            return null;
        }

        const hasLoopbackNode = nodes.some((node) => ["localhost", "127.0.0.1", "::1"].includes(node.host.toLowerCase()));
        if (!isLocalPage && hasLoopbackNode) {
            console.warn("Typesense search is enabled with a localhost node on a public page. Falling back to local search.");
            return null;
        }

        const connectionTimeoutSeconds = Math.max(1, Number(config.connectionTimeoutSeconds) || 5);
        const searchParameters = config.searchParameters && typeof config.searchParameters === "object"
            ? { ...DEFAULT_TYPESENSE_SEARCH_PARAMETERS, ...config.searchParameters }
            : { ...DEFAULT_TYPESENSE_SEARCH_PARAMETERS };
        searchParameters.per_page = Math.max(
            RESULTS_PER_PAGE,
            Number(searchParameters.per_page) || RESULTS_PER_PAGE
        );

        return {
            collectionName,
            apiKey,
            nodes,
            connectionTimeoutSeconds,
            searchParameters,
        };
    }

    async function ensureTypesenseClient() {
        if (state.typesenseResolved) {
            return state.typesenseClient;
        }

        state.typesenseResolved = true;
        const config = getTypesenseSearchConfig();
        if (!config) {
            return null;
        }
        if (typeof Typesense === "undefined" || !Typesense.Client) {
            console.warn("Typesense client library is unavailable. Falling back to local search.");
            return null;
        }

        state.typesenseConfig = config;
        state.typesenseClient = new Typesense.Client({
            nodes: config.nodes,
            apiKey: config.apiKey,
            connectionTimeoutSeconds: config.connectionTimeoutSeconds,
        });
        return state.typesenseClient;
    }

    function isLikelyIssnQuery(value) {
        return compactIssn(value).length === 8 && /^[0-9xX\s-]+$/.test(String(value || ""));
    }

    function escapeTypesenseFilterLiteral(value) {
        return `\`${String(value || "").replace(/`/g, "\\`")}\``;
    }

    function buildTypesenseExactAnyClause(field, values) {
        if (!values || !values.size) {
            return "";
        }
        const tokens = [...values].map((value) => escapeTypesenseFilterLiteral(value));
        return `${field}:=[${tokens.join(",")}]`;
    }

    function buildTypesenseFilterBy({ selectedGrades, selectedAsjc, selectedPublishers, openAccessValue }) {
        const clauses = [];

        if (selectedGrades && selectedGrades.size) {
            clauses.push(buildTypesenseExactAnyClause("grade", selectedGrades));
        }
        if (selectedAsjc && selectedAsjc.size) {
            clauses.push(buildTypesenseExactAnyClause("asjc_codes", selectedAsjc));
        }
        if (selectedPublishers && selectedPublishers.size) {
            clauses.push(buildTypesenseExactAnyClause("publishers", selectedPublishers));
        }
        if (openAccessValue === "Yes") {
            clauses.push("is_open_access:=1");
        } else if (openAccessValue === "No") {
            clauses.push("is_open_access:=0");
        }

        return clauses.filter(Boolean).join(" && ");
    }

    function getTypesenseSortBy(sortValue, mode = "filter") {
        if (mode === "journal") {
            return "_text_match:desc,grade_score:desc,uncertainty:asc";
        }
        if (sortValue === "grade-desc") {
            return "grade_score:desc,primary_title:asc";
        }
        if (sortValue === "grade-asc") {
            return "grade_score:asc,primary_title:asc";
        }
        if (sortValue === "uncertainty-asc") {
            return "uncertainty:asc,grade_score:desc,primary_title:asc";
        }
        return "primary_title:asc";
    }

    function extractTypesenseRecords(response) {
        const hits = Array.isArray(response && response.hits) ? response.hits : [];
        return hits
            .map((hit) => buildRecordFromSearchDocument(hit && hit.document))
            .filter(Boolean);
    }

    async function searchRecordsWithTypesense({
        rawQuery,
        q,
        filterBy,
        sortBy,
    }) {
        const client = await ensureTypesenseClient();
        if (!client || !state.typesenseConfig) {
            return null;
        }

        const baseSearchParameters = {
            ...state.typesenseConfig.searchParameters,
            q: q || (isLikelyIssnQuery(rawQuery) ? compactIssn(rawQuery) : rawQuery),
            page: 1,
        };
        if (filterBy) {
            baseSearchParameters.filter_by = filterBy;
        }
        if (sortBy) {
            baseSearchParameters.sort_by = sortBy;
        }
        let nextPage = 2;

        try {
            const response = await client
                .collections(state.typesenseConfig.collectionName)
                .documents()
                .search(baseSearchParameters);
            const initialRecords = extractTypesenseRecords(response);
            const totalFound = Math.max(
                initialRecords.length,
                Number(response && response.found) || 0
            );
            const loadMoreResults = totalFound > initialRecords.length
                ? async () => {
                    if (((nextPage - 1) * baseSearchParameters.per_page) >= totalFound) {
                        return [];
                    }
                    const nextResponse = await client
                        .collections(state.typesenseConfig.collectionName)
                        .documents()
                        .search({
                            ...baseSearchParameters,
                            page: nextPage,
                        });
                    nextPage += 1;
                    return extractTypesenseRecords(nextResponse);
                }
                : null;

            return {
                records: initialRecords,
                totalFound,
                loadMoreResults,
            };
        } catch (error) {
            console.error("Typesense search failed. Falling back to local search.", error);
            return null;
        }
    }

    async function loadRecords() {
        if (state.records) {
            return state.records;
        }
        if (!state.recordsPromise) {
            state.recordsPromise = (async () => {
                if (!Array.isArray(globalThis.ORBIT_SITE_ROWS)) {
                    await loadScriptOnce(payload.recordsScriptUrl);
                }
                const rawRows = globalThis.ORBIT_SITE_ROWS;
                if (!Array.isArray(rawRows)) {
                    throw new Error("ORBIT site records are missing.");
                }
                const hydratedRecords = rawRows.map(buildRecord);
                state.records = hydratedRecords;
                delete globalThis.ORBIT_SITE_ROWS;
                return hydratedRecords;
            })().finally(() => {
                state.recordsPromise = null;
            });
        }
        return state.recordsPromise;
    }

    function showDataLoadError() {
        elements.resultsContainer.innerHTML = '<p class="text-red-600 my-4">Unable to load journal data. Please try again.</p>';
        elements.paginationContainer.innerHTML = "";
    }

    async function ensureRecords(button, loadingMessage) {
        if (state.records) {
            return state.records;
        }

        const originalText = button ? button.textContent : "";
        if (button) {
            button.disabled = true;
            button.textContent = "Loading...";
        }
        elements.resultsContainer.innerHTML = `<p class="text-gray-600 italic my-4">${escapeHtml(loadingMessage)}</p>`;
        elements.paginationContainer.innerHTML = "";

        try {
            return await loadRecords();
        } catch (error) {
            console.error(error);
            showDataLoadError();
            return null;
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = originalText;
            }
        }
    }

    function sortRecords(items, sortValue) {
        const sorted = [...items];
        sorted.sort((left, right) => {
            if (sortValue === "grade-desc") {
                return gradeValue(right.grade) - gradeValue(left.grade)
                    || left.primaryTitle.localeCompare(right.primaryTitle);
            }
            if (sortValue === "grade-asc") {
                return gradeValue(left.grade) - gradeValue(right.grade)
                    || left.primaryTitle.localeCompare(right.primaryTitle);
            }
            if (sortValue === "uncertainty-asc") {
                return left.uncertainty - right.uncertainty
                    || gradeValue(right.grade) - gradeValue(left.grade)
                    || left.primaryTitle.localeCompare(right.primaryTitle);
            }
            return left.primaryTitle.localeCompare(right.primaryTitle);
        });
        return sorted;
    }

    function renderHomepageLink(record) {
        const firstUrl = record.urls[0];
        if (!firstUrl) {
            return "N/A";
        }
        return `<a href="${escapeHtml(firstUrl)}" target="_blank" rel="noreferrer" class="hyperlink">Click here${externalLinkIcon()}</a>`;
    }

    function renderAsjcDetails(record) {
        if (!record.asjcCodes.length) {
            return "<p>N/A</p>";
        }

        return record.asjcCodes.map((code, index) => {
            const label = payload.asjcLookup[code] || "";
            if (!label && !code) {
                return "";
            }
            const suffix = code && label ? ` (${escapeHtml(code)})` : "";
            return `<p><strong>ASJC ${index + 1}:</strong> ${escapeHtml(label || code)}${suffix}</p>`;
        }).join("");
    }

    function createJournalDetailContent(record) {
        const contentWrapper = document.createElement("div");
        const uncertaintyScore = Number.isFinite(record.uncertainty) ? record.uncertainty.toFixed(2) : "N/A";
        const eliteStatus = (record.flags & FLAGS.elite) === FLAGS.elite ? "Yes" : "No";
        const businessRanking = (record.flags & FLAGS.business) === FLAGS.business ? "Included" : "Excluded";
        const warningFlag = (record.flags & FLAGS.warning) === FLAGS.warning;
        const openAccessValue = isOpenAccess(record) ? (record.openAccessLabel || "Yes") : "No";
        const otherRanksHtml = ["ABDC", "AJG", "FNEGE", "VHB"].map((label) => {
            return `<p><strong>${escapeHtml(RATING_DISPLAY_NAMES[label] || label)}:</strong> ${escapeHtml(formatDisplayValue(record.ratingsMap[label]))}</p>`;
        }).join("");
        const warningListHtml = warningFlag
            ? `<p class="text-red-600 font-semibold"><strong>Warning List${infoIcon("This indicates whether the journal is flagged by a warning or integrity signal in the updated ORBIT release.")}:</strong> Yes</p>`
            : `<p><strong>Warning List${infoIcon("This indicates whether the journal is flagged by a warning or integrity signal in the updated ORBIT release.")}:</strong> No</p>`;

        contentWrapper.innerHTML = `
            <div class="space-y-2 text-sm text-gray-600 pt-3">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                    <div>
                        <p><strong class="lau-green">ORBIT Rank:</strong> <span class="lau-green font-semibold">${escapeHtml(formatDisplayValue(record.grade))}</span></p>
                        <p><strong>Elite Journal${infoIcon("This indicates whether the journal is tagged as elite in the current ORBIT release.")}:</strong> ${eliteStatus}</p>
                        ${warningListHtml}
                        <p><strong>Norwegian Level:</strong> ${escapeHtml(formatDisplayValue(record.ratingsMap.Norwegian))}</p>
                        <p><strong>JUFO Level:</strong> ${escapeHtml(formatDisplayValue(record.ratingsMap.JUFO))}</p>
                        ${otherRanksHtml}
                        <p><strong>Business Rankings${infoIcon("This indicates whether the entry is tagged for the business-oriented ranking signals available in ORBIT.")}:</strong> ${businessRanking}</p>
                        <p><strong>Uncertainty Score${infoIcon("This score quantifies disagreement among the ranking systems. A lower score indicates stronger consensus.")}:</strong> ${uncertaintyScore}</p>
                    </div>
                    <div>
                        <p><strong>ISSN1:</strong> ${escapeHtml(formatDisplayValue(record.issns[0]))}</p>
                        <p><strong>ISSN2:</strong> ${escapeHtml(formatDisplayValue(record.issns[1]))}</p>
                        <p><strong>Publisher:</strong> ${escapeHtml(formatDisplayValue(record.publisherDisplay))}</p>
                        <p><strong>Open Access:</strong> ${escapeHtml(formatDisplayValue(openAccessValue))}</p>
                        <p><strong>Homepage:</strong> ${renderHomepageLink(record)}</p>
                        <div class="pt-2">
                            <h4 class="font-bold text-gray-700">All Science Journal Classification (ASJC)${infoIcon("ASJC classifications replace the old FoR labels in this updated ORBIT release.")}</h4>
                            ${renderAsjcDetails(record)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        return contentWrapper;
    }

    function createJournalCard(record) {
        const card = document.createElement("div");
        card.className = "result-card bg-white rounded-lg shadow-md p-5";
        card.innerHTML = `<h3 class="text-xl font-bold text-gray-800 mb-3">${escapeHtml(record.displayTitle)}</h3>`;
        card.appendChild(createJournalDetailContent(record));
        return card;
    }

    function createFilterListItem(record, listContainer) {
        const wrapper = document.createElement("div");
        const summaryItem = document.createElement("div");
        summaryItem.className = "summary-item flex justify-between items-center p-3 border rounded-md";
        summaryItem.innerHTML = `
            <div>
                <p class="text-xs uppercase text-gray-500 tracking-wide">Journal</p>
                <span class="font-medium text-gray-800">${escapeHtml(record.displayTitle)}</span>
            </div>
            <div class="text-right">
                <span class="lau-green font-semibold text-sm">${escapeHtml(formatDisplayValue(record.grade))}</span>
            </div>
        `;

        const detailItem = document.createElement("div");
        detailItem.className = "hidden p-4 border border-t-0 rounded-b-md bg-gray-50 detail-view";
        detailItem.appendChild(createJournalDetailContent(record));

        summaryItem.addEventListener("click", () => {
            const allDetails = listContainer.querySelectorAll(".detail-view");
            allDetails.forEach((detail) => {
                if (detail !== detailItem && !detail.classList.contains("hidden")) {
                    detail.classList.add("hidden");
                    detail.previousElementSibling.classList.remove("rounded-b-none");
                }
            });
            detailItem.classList.toggle("hidden");
            summaryItem.classList.toggle("rounded-b-none", !detailItem.classList.contains("hidden"));
        });

        wrapper.appendChild(summaryItem);
        wrapper.appendChild(detailItem);
        return wrapper;
    }

    function clearSharedResults() {
        elements.resultsContainer.innerHTML = "";
        elements.paginationContainer.innerHTML = "";
        state.currentOffset = 0;
        state.currentResultsTotal = 0;
        state.loadMoreResults = null;
    }

    function clearPendingJournalSearch() {
        if (state.journalSearchDebounceId !== null) {
            window.clearTimeout(state.journalSearchDebounceId);
            state.journalSearchDebounceId = null;
        }
    }

    function showJournalSearchPrompt() {
        state.activeMode = "journal";
        state.currentResults = [];
        clearSharedResults();
        elements.resultsContainer.innerHTML = '<p class="text-gray-600 italic my-4">Type a journal name or ISSN to search.</p>';
    }

    function queueJournalSearch({ immediate = false } = {}) {
        clearPendingJournalSearch();
        if (immediate) {
            void runJournalSearch();
            return;
        }
        state.journalSearchDebounceId = window.setTimeout(() => {
            state.journalSearchDebounceId = null;
            void runJournalSearch();
        }, 250);
    }

    async function ensureLoadedResults(minimumCount) {
        while (state.currentResults.length < minimumCount && typeof state.loadMoreResults === "function") {
            const nextBatch = await state.loadMoreResults();
            if (!Array.isArray(nextBatch) || !nextBatch.length) {
                state.loadMoreResults = null;
                break;
            }
            state.currentResults.push(...nextBatch);
        }
    }

    async function displayResults(isLoadMore = false) {
        const isFilterSearch = state.activeMode === "filter";
        const totalResults = Math.max(state.currentResultsTotal, state.currentResults.length);

        if (!isLoadMore) {
            elements.resultsContainer.innerHTML = "";
            elements.paginationContainer.innerHTML = "";
            state.currentOffset = 0;

            const statusMessage = document.createElement("p");
            statusMessage.className = "text-gray-600 italic my-4";
            const label = isFilterSearch ? "result" : "journal";
            statusMessage.textContent = `Found ${formatNumber(totalResults)} ${label}${totalResults === 1 ? "" : "s"}.`;
            elements.resultsContainer.appendChild(statusMessage);
        }

        await ensureLoadedResults(state.currentOffset + RESULTS_PER_PAGE);

        if (!totalResults) {
            elements.paginationContainer.innerHTML = "";
            return;
        }

        let listContainer = elements.resultsContainer.querySelector(".results-list-container");
        if (!listContainer) {
            listContainer = document.createElement("div");
            listContainer.className = isFilterSearch ? "results-list-container space-y-2" : "results-list-container flex flex-col gap-6";
            elements.resultsContainer.appendChild(listContainer);
        }

        const resultsToShow = state.currentResults.slice(state.currentOffset, state.currentOffset + RESULTS_PER_PAGE);
        resultsToShow.forEach((record) => {
            const card = isFilterSearch ? createFilterListItem(record, listContainer) : createJournalCard(record);
            listContainer.appendChild(card);
        });

        state.currentOffset += resultsToShow.length;
        elements.paginationContainer.innerHTML = "";
        if (state.currentOffset < totalResults) {
            createLoadMoreButton();
        }
    }

    function createLoadMoreButton() {
        const button = document.createElement("button");
        button.id = "load-more-btn";
        button.className = "bg-lau-green text-white px-6 py-2 rounded-md hover:bg-opacity-90 transition";
        button.textContent = "Load More";

        const progressBar = document.createElement("div");
        progressBar.className = "w-full bg-gray-200 rounded-full h-1.5 mt-2 hidden";
        progressBar.innerHTML = '<div class="bg-lau-green h-1.5 rounded-full" style="width: 0%"></div>';

        button.addEventListener("click", async () => {
            button.textContent = "Loading...";
            button.disabled = true;
            progressBar.classList.remove("hidden");

            const progress = progressBar.firstChild;
            progress.style.width = "100%";

            try {
                await displayResults(true);
            } catch (error) {
                console.error("Unable to load more search results.", error);
                elements.paginationContainer.innerHTML = '<p class="text-red-600 text-sm">Unable to load additional results. Please try again.</p>';
            }
        });

        elements.paginationContainer.appendChild(button);
        elements.paginationContainer.appendChild(progressBar);
    }

    async function runJournalSearch() {
        const rawQuery = elements.journalInput.value.trim();
        const requestToken = state.journalSearchRequestToken + 1;
        state.journalSearchRequestToken = requestToken;

        if (!rawQuery) {
            showJournalSearchPrompt();
            return;
        }

        elements.resultsContainer.innerHTML = '<p class="text-gray-600 italic my-4">Searching journals...</p>';
        elements.paginationContainer.innerHTML = "";

        const typesenseResults = await searchRecordsWithTypesense({
            rawQuery,
            sortBy: getTypesenseSortBy("grade-desc", "journal"),
        });
        if (requestToken !== state.journalSearchRequestToken) {
            return;
        }
        state.activeMode = "journal";

        if (typesenseResults !== null) {
            state.currentResults = typesenseResults.records;
            state.currentResultsTotal = typesenseResults.totalFound;
            state.loadMoreResults = typesenseResults.loadMoreResults;
            await displayResults();
            return;
        }

        const records = await ensureRecords(null, "Loading journal data...");
        if (requestToken !== state.journalSearchRequestToken || !records) {
            return;
        }

        const query = normalizeText(rawQuery);
        const issnQuery = compactIssn(rawQuery);

        state.currentResults = sortRecords(records.filter((record) => {
            if (query && record.normalizedTitle.includes(query)) {
                return true;
            }
            return issnQuery && record.compactIssns.some((issn) => issn === issnQuery);
        }), "grade-desc");
        state.currentResultsTotal = state.currentResults.length;
        state.loadMoreResults = null;

        if (requestToken !== state.journalSearchRequestToken) {
            return;
        }

        await displayResults();
    }

    async function runFilterSearch() {
        clearPendingJournalSearch();
        state.journalSearchRequestToken += 1;
        state.activeMode = "filter";
        const selectedGrades = new Set(state.tomSelect.rank ? state.tomSelect.rank.getValue() : []);
        const selectedAsjc = new Set(state.tomSelect.asjc ? state.tomSelect.asjc.getValue() : []);
        const selectedPublishers = new Set(state.tomSelect.publisher ? state.tomSelect.publisher.getValue() : []);
        const openAccessValue = elements.openAccessSelect.value;
        const sortValue = elements.sortSelect.value;

        const originalText = elements.filterBtn.textContent;
        elements.filterBtn.disabled = true;
        elements.filterBtn.textContent = "Filtering...";
        elements.resultsContainer.innerHTML = '<p class="text-gray-600 italic my-4">Filtering journals...</p>';
        elements.paginationContainer.innerHTML = "";

        try {
            const typesenseResults = await searchRecordsWithTypesense({
                q: "*",
                filterBy: buildTypesenseFilterBy({
                    selectedGrades,
                    selectedAsjc,
                    selectedPublishers,
                    openAccessValue,
                }),
                sortBy: getTypesenseSortBy(sortValue, "filter"),
            });

            if (typesenseResults !== null) {
                state.currentResults = typesenseResults.records;
                state.currentResultsTotal = typesenseResults.totalFound;
                state.loadMoreResults = typesenseResults.loadMoreResults;
                await displayResults();
                return;
            }

            const records = await ensureRecords(null, "Loading journal data...");
            if (!records) {
                return;
            }

            state.currentResults = sortRecords(records.filter((record) => {
                if (selectedGrades.size && !selectedGrades.has(record.grade)) {
                    return false;
                }
                if (selectedAsjc.size && !record.asjcCodes.some((code) => selectedAsjc.has(code))) {
                    return false;
                }
                if (selectedPublishers.size && !record.publishers.some((publisher) => selectedPublishers.has(publisher))) {
                    return false;
                }
                if (openAccessValue === "Yes" && !isOpenAccess(record)) {
                    return false;
                }
                if (openAccessValue === "No" && isOpenAccess(record)) {
                    return false;
                }
                return true;
            }), sortValue);
            state.currentResultsTotal = state.currentResults.length;
            state.loadMoreResults = null;

            await displayResults();
        } finally {
            elements.filterBtn.disabled = false;
            elements.filterBtn.textContent = originalText;
        }
    }

    function resetFilterPanel() {
        clearPendingJournalSearch();
        state.journalSearchRequestToken += 1;
        if (state.tomSelect.rank) {
            state.tomSelect.rank.clear(true);
        }
        if (state.tomSelect.asjc) {
            state.tomSelect.asjc.clear(true);
        }
        if (state.tomSelect.publisher) {
            state.tomSelect.publisher.clear(true);
        }
        elements.openAccessSelect.value = "All";
        elements.sortSelect.value = "name-asc";
        state.activeMode = "filter";
        state.currentResults = [];
        clearSharedResults();
    }

    function switchTab(nextTab) {
        clearPendingJournalSearch();
        state.journalSearchRequestToken += 1;
        state.activeTab = nextTab;
        state.activeMode = nextTab === "filter" ? "filter" : "journal";
        state.currentResults = [];
        clearSharedResults();

        const tabs = {
            journal: { button: elements.tabJournalSearch, panel: elements.panelJournalSearch },
            filter: { button: elements.tabFilterSearch, panel: elements.panelFilterSearch },
            about: { button: elements.tabAbout, panel: elements.panelAbout },
            faq: { button: elements.tabFaq, panel: elements.panelFaq },
            contact: { button: elements.tabContact, panel: elements.panelContact },
        };

        Object.values(tabs).forEach(({ button, panel }) => {
            button.classList.remove("active");
            panel.classList.add("hidden");
        });

        tabs[nextTab].button.classList.add("active");
        tabs[nextTab].panel.classList.remove("hidden");

        if (nextTab === "filter" && !state.selectsReady) {
            initializeSelects();
            state.selectsReady = true;
        }

        if (nextTab === "about" && !state.aboutReady) {
            renderAboutStats();
            renderRankingDistributionChart();
            state.aboutReady = true;
        }

        if (nextTab === "journal") {
            if (elements.journalInput.value.trim()) {
                queueJournalSearch({ immediate: true });
            } else {
                showJournalSearchPrompt();
            }
        }
    }

    function renderAboutStats() {
        const gradedTotal = payload.stats.gradedEntries || 1;
        elements.aboutGradeTableBody.innerHTML = ["A+", "A", "B", "C", "D"].map((grade) => {
            const count = payload.stats.gradeCounts[grade] || 0;
            const share = `${((count / gradedTotal) * 100).toFixed(2)}%`;
            return `
                <tr>
                    <td class="p-2 border align-top">${escapeHtml(grade)}</td>
                    <td class="p-2 border align-top">${formatNumber(count)}</td>
                    <td class="p-2 border align-top">${share}</td>
                    <td class="p-2 border">${escapeHtml(GRADE_MEANINGS[grade])}</td>
                </tr>
            `;
        }).join("");

        elements.aboutSummaryStats.textContent = `The grade distribution is based on ${formatNumber(payload.stats.gradedEntries)} journals ranked by ORBIT, excluding ${formatNumber(payload.stats.unrankedEntries)} unranked titles. The updated release maps ${formatNumber(payload.stats.asjcCount)} distinct ASJC classes.`;
    }

    function renderRankingDistributionChart() {
        if (!elements.rankingDistributionChart) {
            return;
        }

        const chart = payload.rankingDistributions;
        if (!chart || !Array.isArray(chart.xValues) || !Array.isArray(chart.systems) || !chart.systems.length) {
            elements.rankingDistributionChart.innerHTML = '<p class="text-sm text-gray-600">Ranking distribution chart unavailable.</p>';
            return;
        }

        const width = 820;
        const height = 460;
        const legendRows = Math.ceil(chart.systems.length / 3);
        const margin = { top: 28 + (legendRows * 18) + 18, right: 20, bottom: 48, left: 56 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;
        const xMin = chart.xValues[0] ?? 0;
        const xMax = chart.xValues[chart.xValues.length - 1] ?? 100;
        const maxY = chart.systems.reduce((largest, system) => {
            const systemMax = Array.isArray(system.curve) && system.curve.length
                ? Math.max(...system.curve)
                : 0;
            return Math.max(largest, systemMax);
        }, 0.001);
        const xScale = (value) => margin.left + (((value - xMin) / Math.max(xMax - xMin, 1)) * plotWidth);
        const yScale = (value) => margin.top + plotHeight - ((value / maxY) * plotHeight);
        const formatDensityTick = (value) => (value >= 0.1 ? value.toFixed(2) : value.toFixed(3));

        const horizontalGrid = Array.from({ length: 5 }, (_, index) => {
            const tickValue = (maxY * index) / 4;
            const y = yScale(tickValue);
            return `
                <g>
                    <line x1="${margin.left}" y1="${y.toFixed(2)}" x2="${(width - margin.right).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#E5E7EB" stroke-width="1"></line>
                    <text x="${(margin.left - 8).toFixed(2)}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="#6B7280" font-size="11">${formatDensityTick(tickValue)}</text>
                </g>
            `;
        }).join("");

        const verticalGrid = [0, 20, 40, 60, 80, 100].map((tickValue) => {
            const x = xScale(tickValue);
            return `
                <g>
                    <line x1="${x.toFixed(2)}" y1="${margin.top}" x2="${x.toFixed(2)}" y2="${(margin.top + plotHeight).toFixed(2)}" stroke="#F3F4F6" stroke-width="1"></line>
                    <text x="${x.toFixed(2)}" y="${(height - 18).toFixed(2)}" text-anchor="middle" fill="#6B7280" font-size="11">${tickValue}</text>
                </g>
            `;
        }).join("");

        const pathGroups = chart.systems.map((system) => {
            const curve = Array.isArray(system.curve) ? system.curve : [];
            const pointCount = Math.min(chart.xValues.length, curve.length);
            const pathData = Array.from({ length: pointCount }, (_, index) => {
                const x = xScale(chart.xValues[index]).toFixed(2);
                const y = yScale(curve[index]).toFixed(2);
                return `${index === 0 ? "M" : "L"} ${x} ${y}`;
            }).join(" ");
            const rankSummary = Array.isArray(system.rankCounts)
                ? system.rankCounts.map((entry) => `${entry.rank}: ${formatNumber(entry.count)}`).join(", ")
                : "";

            return `
                <g>
                    <title>${escapeHtml(`${system.label} (${formatNumber(system.sampleSize || 0)} entries). ${rankSummary}`)}</title>
                    <path d="${pathData}" fill="none" stroke="${system.color}" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"></path>
                </g>
            `;
        }).join("");

        const legendItems = chart.systems.map((system, index) => {
            const column = index % 3;
            const row = Math.floor(index / 3);
            const x = margin.left + (column * 240);
            const y = 18 + (row * 18);
            return `
                <g transform="translate(${x}, ${y})">
                    <line x1="0" y1="0" x2="20" y2="0" stroke="${system.color}" stroke-width="3" stroke-linecap="round"></line>
                    <text x="28" y="4" fill="#374151" font-size="11">${escapeHtml(`${system.label} n=${formatNumber(system.sampleSize || 0)}`)}</text>
                </g>
            `;
        }).join("");

        elements.rankingDistributionChart.innerHTML = `
            <svg viewBox="0 0 ${width} ${height}" class="w-full h-auto" role="img" aria-label="Probability density functions of ranking system and ORBIT percentile score distributions">
                <title>Probability Density Functions of Ranking System and ORBIT Percentile Score Distributions</title>
                ${legendItems}
                ${horizontalGrid}
                ${verticalGrid}
                <rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="#9CA3AF" stroke-width="1"></rect>
                ${pathGroups}
                <text x="${margin.left - 38}" y="${(margin.top + (plotHeight / 2)).toFixed(2)}" text-anchor="middle" fill="#4B5563" font-size="12" transform="rotate(-90 ${margin.left - 38} ${margin.top + (plotHeight / 2)})">Density</text>
                <text x="${(margin.left + (plotWidth / 2)).toFixed(2)}" y="${(height - 4).toFixed(2)}" text-anchor="middle" fill="#4B5563" font-size="12">Percentile Score</text>
            </svg>
        `;
    }

    function renderFaqSection(container, items) {
        container.innerHTML = items.map((item) => `
            <div class="faq-item border rounded-md">
                <div class="faq-question cursor-pointer flex justify-between items-center p-4 bg-gray-50 hover:bg-gray-100 transition">
                    <span class="font-semibold text-gray-800">${escapeHtml(item.question)}</span>
                    <svg class="faq-arrow w-5 h-5 text-gray-500 transition-transform transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
                <div class="faq-answer hidden p-4 border-t border-gray-200 bg-gray-50 text-gray-700 prose max-w-none">
                    ${item.answer}
                </div>
            </div>
        `).join("");
    }

    function attachFaqEvents() {
        elements.panelFaq.addEventListener("click", (event) => {
            const questionHeader = event.target.closest(".faq-question");
            if (!questionHeader) {
                return;
            }

            const faqItem = questionHeader.parentElement;
            const answer = faqItem.querySelector(".faq-answer");
            const shouldOpen = answer.classList.contains("hidden");

            const allItems = elements.panelFaq.querySelectorAll(".faq-item");
            allItems.forEach((item) => {
                item.querySelector(".faq-answer").classList.add("hidden");
                item.querySelector(".faq-question").classList.remove("active");
            });

            if (shouldOpen) {
                answer.classList.remove("hidden");
                questionHeader.classList.add("active");
            }
        });
    }

    function initializeSelects() {
        const uniquePublishers = Array.isArray(payload.publisherOptions) ? payload.publisherOptions : [];
        const asjcOptions = Object.entries(payload.asjcLookup)
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([code, label]) => ({ value: code, text: `${code} ${label}` }));

        const sharedConfig = {
            plugins: ["remove_button"],
            persist: false,
            create: false,
            hidePlaceholder: true,
            maxOptions: 1000,
        };

        if (typeof TomSelect !== "undefined") {
            state.tomSelect.rank = new TomSelect(elements.rankSelect, {
                ...sharedConfig,
                placeholder: "Select grades...",
                options: GRADE_ORDER.map((grade) => ({ value: grade, text: grade })),
            });

            state.tomSelect.asjc = new TomSelect(elements.asjcSelect, {
                ...sharedConfig,
                placeholder: "Select ASJC codes or names...",
                options: asjcOptions,
            });

            state.tomSelect.publisher = new TomSelect(elements.publisherSelect, {
                ...sharedConfig,
                placeholder: "Select publishers...",
                options: uniquePublishers.map((publisher) => ({ value: publisher, text: publisher })),
            });
        }
    }

    function bindEvents() {
        elements.journalInput.addEventListener("input", () => {
            if (state.activeTab !== "journal") {
                return;
            }
            queueJournalSearch();
        });
        elements.journalInput.addEventListener("keyup", (event) => {
            if (event.key === "Enter") {
                queueJournalSearch({ immediate: true });
            }
        });
        elements.clearSearchBtn.addEventListener("click", () => {
            clearPendingJournalSearch();
            state.journalSearchRequestToken += 1;
            elements.journalInput.value = "";
            showJournalSearchPrompt();
            elements.journalInput.focus();
        });

        elements.filterBtn.addEventListener("click", () => {
            void runFilterSearch();
        });
        elements.resetBtn.addEventListener("click", resetFilterPanel);

        elements.tabJournalSearch.addEventListener("click", () => switchTab("journal"));
        elements.tabFilterSearch.addEventListener("click", () => switchTab("filter"));
        elements.tabAbout.addEventListener("click", () => switchTab("about"));
        elements.tabFaq.addEventListener("click", () => switchTab("faq"));
        elements.tabContact.addEventListener("click", () => switchTab("contact"));
    }

    function init() {
        elements.tabContainer.classList.remove("hidden");

        renderFaqSection(elements.faqJournalsMethodology, [
            {
                question: "What is the main goal of the ORBIT system?",
                answer: `The primary goal of ORBIT is to provide a more stable and holistic measure of a journal's standing by synthesizing the expert opinions from multiple, established international ranking systems. This approach helps to resolve disagreements between individual lists and reduces the biases inherent in any single ranking.`,
            },
            {
                question: "Why are citation-based metrics like JIF, SJR, or CiteScore not used?",
                answer: `ORBIT is intentionally designed to be an alternative to citation-based metrics. Citation metrics often reward popularity over rigor, and can be inflated by self-citations, editorial strategies, or even paper mills, making them unreliable indicators of true scholarly quality. Our framework prioritizes expert-driven, tier-based evaluations which are designed to reflect perceived academic quality and reputation.`,
            },
            {
                question: "Can you provide more context on why citation-based metrics are considered problematic?",
                answer: `Citation-based metrics such as the h-index, CiteScore, and SNIP are widely used but suffer from both practical and conceptual flaws. A striking example comes from the 2025 Google Scholar venue rankings, which place <i>IEEE Access</i> and MDPI's <i>Sustainability</i> among the top 30 journals worldwide, ranking them above <i>Nature Medicine</i>, <i>JACS</i>, and <i>BMJ</i>. This is despite the fact that these journals have been flagged by the Chinese Academy of Sciences and assigned the lowest rating by both JUFO and the Norwegian Register. In mathematics and physics, the situation is reversed: prestigious journals like the <i>Annals of Mathematics</i> are entirely unranked, while questionable titles like <i>Chaos, Solitons &amp; Fractals</i> are prominently listed. This reflects a systemic bias toward citation volume rather than scholarly quality.<br><br>From a theoretical standpoint, these metrics also fail under the lens of statistical decision theory. If journal evaluation is treated as a hypothesis test, where the null hypothesis is that a journal is not of high quality, then a reliable metric should minimize both Type I errors (false positives) and Type II errors (false negatives). Citation-based systems are prone to both. For instance, CiteScore places over 130 MDPI journals in the top quartile, including <i>Cells</i>, which appears on the Early Warning List issued by the Chinese Academy of Sciences. Yet expert-based systems like ORBIT assign none of these journals top grades, with most receiving a D. At the same time, citation metrics tend to penalize respected but slower-citing journals like <i>MIT Sloan Management Review</i>, which ranks poorly despite being on the FT50 list. These inconsistencies highlight how citation-based rankings can mislead real-world decisions in tenure, funding, and evaluation.`,
            },
            {
                question: "Why are major indexing databases such as Scopus or Web of Science not included as a ranking system?",
                answer: `Indexing databases serve a different, albeit critical, function: they verify a journal's existence and discoverability, not its quality. Inclusion standards can vary, and presence in an index does not equate to academic reputation. ORBIT focuses on systems that actively assess and rank journals based on quality, not just on their inclusion in a database.`,
            },
            {
                question: "Why are other national ranking systems like the Danish list or HCERES (France) not included?",
                answer: `Our methodology requires that we only include ranking systems that are actively and regularly updated, are primarily expert-driven rather than purely metric-based, and are integrative in nature. Many national systems are either no longer maintained or rely heavily on citation indicators. If you know of a system that fits our criteria, please let us know.`,
            },
            {
                question: "Why does ORBIT convert continuous scores into letter grades, and what are the trade-offs?",
                answer: `Although ORBIT generates a continuous score for each journal, it is quantized into five letter grades (A+, A, B, C, D) to support clearer decision-making in academic evaluation and policy. This five-grade system strikes a balance between simplicity and informativeness. The main benefit is that it offers an easily interpretable summary of a journal's standing. However, this quantization also leads to a loss of detail; two journals with different ORBIT scores might fall into the same grade category. To mitigate this, ORBIT provides a continuous uncertainty score that should be used alongside the letter grade, especially for journals near grade boundaries or with high uncertainty.`,
            },
            {
                question: "What are the Elite and Warning lists used for overrides?",
                answer: `To ground our percentile-based grading in a real-world benchmark, we use a ground truth for the absolute top and bottom tiers. Elite status is based on a journal's inclusion in highly regarded international lists like the Nature Index, FT50, and UTD24. Warning status is based on inclusion in lists of predatory or questionable publications, such as the CAS Warning List. These are used to apply a final override, ensuring that journals with a universal reputation for excellence or poor quality are graded accordingly.`,
            },
            {
                question: "How reliable is the ground truth dataset used to validate the ranking systems? Could different elite lists change the results?",
                answer: `The ground truth dataset is based on globally recognized sources, but it has its own inherent subjectivity. The concept of a definitive elite list is open to academic debate, and using different ground truth sources could lead to different reliability scores for the ranking systems.`,
            },
            {
                question: "How does ORBIT perform compared to existing journal ranking systems?",
                answer: `ORBIT consistently outperforms individual ranking systems in both stability and accuracy. By aggregating multiple expert-based lists through a reliability-weighted, pessimistic approach, it generates a consensus score that reflects the central point of agreement across systems. Internal coherence analysis shows that ORBIT's average error against a simple consensus is nearly ten times lower than that of the next-best system, demonstrating that it is not just a compromise, but a statistically superior representation.`,
            },
            {
                question: "How often is the ORBIT system updated?",
                answer: `The ORBIT rankings are updated whenever one of the source ranking systems releases a new version. Once a new list is published, the integration and recalculation process typically takes one to two weeks to complete.`,
            },
        ]);

        renderFaqSection(elements.faqJournalsUsage, [
            {
                question: "How is the ORBIT score for a non-business journal calculated, and is it as reliable as the score for a business journal?",
                answer: `For journals outside of business and management, the ORBIT score is based primarily on the JUFO and Norwegian systems. Because these are the only comprehensive, multidisciplinary lists used, the consensus for non-business fields is less diversified than for business journals, which can be evaluated by up to six systems.`,
            },
            {
                question: "Why doesn't a specific journal have an ORBIT rank?",
                answer: `ORBIT only assigns a rank and score to journals that are evaluated by at least two of the international ranking systems we use. This policy ensures that every ORBIT score is a true consensus and not based on a single opinion. While this may exclude some specialized journals, it significantly increases the reliability of the ranks we do provide.`,
            },
            {
                question: "How should I interpret the Uncertainty Score?",
                answer: `The Uncertainty Score measures how much the different ranking systems disagree about a journal's quality. A low score (for example, below 0.1) is excellent. It indicates a strong consensus, meaning the ORBIT grade is very reliable. A high score (for example, above 0.4) is a warning flag. It means the ranking systems have conflicting opinions, so while the ORBIT grade represents the mathematical average, it should be interpreted with caution.`,
            },
            {
                question: "My journal has a good ORBIT grade (for example, A) but a high uncertainty score. How should I interpret this?",
                answer: `This is a key feature of the ORBIT system. It means that while the average of the expert opinions places your journal in a high tier, there is significant disagreement among the different ranking systems. For example, one system might rank it as A+ while another ranks it as B or C. The A grade tells you its overall position, but the high uncertainty score is a crucial piece of context, signaling that the journal's prestige is not universally agreed upon across all academic communities or regions.`,
            },
            {
                question: "Does the ORBIT system unintentionally penalize journals from non-English speaking regions or those with a strong regional focus?",
                answer: `The ORBIT model is designed to mitigate this risk by including multiple international systems with different geographical focuses, such as VHB for the German-speaking world, FNEGE for France, and ABDC for the Asia-Pacific region. By aggregating these diverse perspectives, ORBIT is less likely to be biased by the perspective of any single region compared to relying on a single, globally dominant list. However, because the included lists are themselves predominantly European and Australian, some regional biases may still persist.`,
            },
            {
                question: "How should a university or a promotion committee use the ORBIT rankings in practice?",
                answer: `ORBIT is designed to be a tool that supports, rather than replaces, expert judgment, in line with the DORA and Leiden Manifesto principles. A committee could use the ORBIT grade as a primary indicator of a journal's overall standing. Crucially, they should also consider the Uncertainty Score. A high uncertainty score should prompt a deeper, qualitative review of the publication, as it indicates that the journal's quality is disputed. Using both metrics together provides a much more nuanced and defensible basis for evaluation than using a simple letter grade alone.`,
            },
        ]);

        attachFaqEvents();
        bindEvents();
        switchTab("journal");
    }

    init();
})();
