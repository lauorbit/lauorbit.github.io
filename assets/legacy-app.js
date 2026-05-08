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
    const PUBLISHER_ROW = {
        name: 0,
        aliases: 1,
        jufoIsbns: 2,
        norwegianIsbns: 3,
        sharedIsbns: 4,
        jufoLevel: 5,
        norwegianLevel: 6,
        grade: 7,
        reliability: 8,
        url: 9,
    };
    const CONFERENCE_ROW = {
        name: 0,
        issns: 1,
        grade: 2,
        uncertainty: 3,
        coreRank: 4,
        jufoLevel: 5,
        norwegianLevel: 6,
    };

    const FLAGS = payload.flagBits;
    const RESULTS_PER_PAGE = 50;
    const SEARCH_INDEX_BATCH_SIZE = 250;
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
        conferenceInput: document.getElementById("conference-input"),
        publisherSearchInput: document.getElementById("publisher-search-input"),
        clearSearchBtn: document.getElementById("clear-search-btn"),
        clearConferenceSearchBtn: document.getElementById("clear-conference-search-btn"),
        clearPublisherSearchBtn: document.getElementById("clear-publisher-search-btn"),
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
        tabConferenceSearch: document.getElementById("tab-conference-search"),
        tabPublisherSearch: document.getElementById("tab-publisher-search"),
        tabFilterSearch: document.getElementById("tab-filter-search"),
        tabAbout: document.getElementById("tab-about"),
        tabFaq: document.getElementById("tab-faq"),
        tabContact: document.getElementById("tab-contact"),
        panelJournalSearch: document.getElementById("panel-journal-search"),
        panelConferenceSearch: document.getElementById("panel-conference-search"),
        panelPublisherSearch: document.getElementById("panel-publisher-search"),
        panelFilterSearch: document.getElementById("panel-filter-search"),
        panelAbout: document.getElementById("panel-about"),
        panelFaq: document.getElementById("panel-faq"),
        panelContact: document.getElementById("panel-contact"),
        aboutTabJournals: document.getElementById("about-tab-journals"),
        aboutTabConferences: document.getElementById("about-tab-conferences"),
        aboutTabPublishers: document.getElementById("about-tab-publishers"),
        aboutPanelJournals: document.getElementById("about-panel-journals"),
        aboutPanelConferences: document.getElementById("about-panel-conferences"),
        aboutPanelPublishers: document.getElementById("about-panel-publishers"),
        aboutGradeTableBody: document.getElementById("about-grade-table-body"),
        aboutSummaryStats: document.getElementById("about-summary-stats"),
        faqJournalsMethodology: document.getElementById("faq-journals-methodology"),
        faqJournalsUsage: document.getElementById("faq-journals-usage"),
        faqConferences: document.getElementById("faq-conferences"),
        faqPublishers: document.getElementById("faq-publishers"),
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
        conferenceRecords: null,
        publisherRecords: null,
        searchIndexesPromise: null,
        primaryTitleSearchIndex: null,
        titleVariantSearchIndex: null,
        issnSearchIndex: null,
        recordById: null,
        journalSearchDebounceId: null,
        conferenceSearchDebounceId: null,
        publisherSearchDebounceId: null,
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

    function uniqueValues(values) {
        const results = [];
        const seen = new Set();
        values.forEach((value) => {
            const text = String(value || "").trim();
            const key = text.toLowerCase();
            if (!text || seen.has(key)) {
                return;
            }
            seen.add(key);
            results.push(text);
        });
        return results;
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
            normalizedPrimaryTitle: normalizeText(titleVariants[0] || ""),
            normalizedTitleVariants: titleVariants.map(normalizeText).filter(Boolean),
            normalizedVariantTitles: titleVariants.slice(1).map(normalizeText).filter(Boolean),
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

    function buildConferenceRecord(row, index) {
        const name = row[CONFERENCE_ROW.name] || "Untitled conference";
        const issns = Array.isArray(row[CONFERENCE_ROW.issns]) ? row[CONFERENCE_ROW.issns] : [];
        return {
            id: index,
            name,
            displayName: toDisplayTitleCase(name),
            normalizedName: normalizeText(name),
            issns,
            compactIssns: issns.map(compactIssn),
            grade: row[CONFERENCE_ROW.grade] || "Unranked",
            uncertainty: typeof row[CONFERENCE_ROW.uncertainty] === "number" ? row[CONFERENCE_ROW.uncertainty] : Number(row[CONFERENCE_ROW.uncertainty] || 0),
            coreRank: row[CONFERENCE_ROW.coreRank] || "",
            jufoLevel: row[CONFERENCE_ROW.jufoLevel] || "",
            norwegianLevel: row[CONFERENCE_ROW.norwegianLevel] || "",
        };
    }

    function buildPublisherRecord(row, index) {
        const aliases = Array.isArray(row[PUBLISHER_ROW.aliases]) ? row[PUBLISHER_ROW.aliases] : splitPipeValues(row[PUBLISHER_ROW.name]);
        const displayName = row[PUBLISHER_ROW.name] || aliases[0] || "Untitled publisher";
        const jufoIsbns = Array.isArray(row[PUBLISHER_ROW.jufoIsbns]) ? row[PUBLISHER_ROW.jufoIsbns] : [];
        const norwegianIsbns = Array.isArray(row[PUBLISHER_ROW.norwegianIsbns]) ? row[PUBLISHER_ROW.norwegianIsbns] : [];
        const sharedIsbns = Array.isArray(row[PUBLISHER_ROW.sharedIsbns]) ? row[PUBLISHER_ROW.sharedIsbns] : [];
        const allIsbns = uniqueValues([...jufoIsbns, ...norwegianIsbns, ...sharedIsbns]);
        return {
            id: index,
            name: displayName,
            displayName: toDisplayTitleCase(displayName),
            aliases,
            normalizedName: normalizeText(displayName),
            normalizedAliases: aliases.map(normalizeText).filter(Boolean),
            jufoIsbns,
            norwegianIsbns,
            sharedIsbns,
            allIsbns,
            compactIsbns: allIsbns.map(compactIssn),
            jufoLevel: row[PUBLISHER_ROW.jufoLevel] || "",
            norwegianLevel: row[PUBLISHER_ROW.norwegianLevel] || "",
            grade: row[PUBLISHER_ROW.grade] || "Unranked",
            reliability: typeof row[PUBLISHER_ROW.reliability] === "number" ? row[PUBLISHER_ROW.reliability] : Number(row[PUBLISHER_ROW.reliability] || 0),
            url: row[PUBLISHER_ROW.url] || "",
        };
    }

    function yieldToBrowser() {
        return new Promise((resolve) => {
            window.setTimeout(resolve, 0);
        });
    }

    function createSearchIndexes() {
        if (typeof FlexSearch === "undefined" || !FlexSearch.Index) {
            console.warn("FlexSearch is unavailable. Falling back to linear search.");
            return null;
        }

        return {
            primaryTitle: new FlexSearch.Index({
                tokenize: "forward",
            }),
            titleVariant: new FlexSearch.Index({
                tokenize: "forward",
            }),
            issn: new FlexSearch.Index({
                tokenize: "forward",
            }),
        };
    }

    function normalizeSearchIds(result) {
        if (!Array.isArray(result)) {
            return [];
        }

        return result
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value));
    }

    function mergeSearchIds(...groups) {
        const merged = [];
        const seen = new Set();

        groups.forEach((group) => {
            group.forEach((id) => {
                if (seen.has(id)) {
                    return;
                }
                seen.add(id);
                merged.push(id);
            });
        });

        return merged;
    }

    function mergeRecordGroups(...groups) {
        const merged = [];
        const seen = new Set();

        groups.forEach((group) => {
            group.forEach((record) => {
                if (!record || seen.has(record.id)) {
                    return;
                }
                seen.add(record.id);
                merged.push(record);
            });
        });

        return merged;
    }

    function compareJournalSearchRecords(left, right) {
        return gradeValue(right.grade) - gradeValue(left.grade)
            || left.uncertainty - right.uncertainty
            || left.primaryTitle.localeCompare(right.primaryTitle);
    }

    function sortJournalSearchRecords(records) {
        return [...records].sort(compareJournalSearchRecords);
    }

    function matchesPrimaryTitle(record, matcher) {
        return Boolean(record.normalizedPrimaryTitle) && matcher(record.normalizedPrimaryTitle);
    }

    function matchesVariantTitle(record, matcher) {
        return record.normalizedVariantTitles.some((variant) => matcher(variant));
    }

    function hasOrderedTokenMatch(value, queryTokens) {
        if (!queryTokens.length) {
            return false;
        }

        let nextIndex = 0;
        for (const token of queryTokens) {
            const matchIndex = value.indexOf(token, nextIndex);
            if (matchIndex === -1) {
                return false;
            }
            nextIndex = matchIndex + token.length;
        }

        return true;
    }

    function collectLinearSearchBuckets(records, normalizedQuery, issnQuery) {
        const queryTokens = normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : [];
        const buckets = {
            exactIssn: [],
            exactPrimaryTitle: [],
            prefixPrimaryTitle: [],
            phrasePrimaryTitle: [],
            orderedPrimaryTokens: [],
            allPrimaryTokens: [],
            exactVariantTitle: [],
            prefixVariantTitle: [],
            phraseVariantTitle: [],
            orderedVariantTokens: [],
            allVariantTokens: [],
        };

        records.forEach((record) => {
            if (issnQuery && record.compactIssns.some((issn) => issn === issnQuery)) {
                buckets.exactIssn.push(record);
                return;
            }
            if (!normalizedQuery) {
                return;
            }
            if (matchesPrimaryTitle(record, (value) => value === normalizedQuery)) {
                buckets.exactPrimaryTitle.push(record);
                return;
            }
            if (matchesPrimaryTitle(record, (value) => value.startsWith(normalizedQuery))) {
                buckets.prefixPrimaryTitle.push(record);
                return;
            }
            if (matchesPrimaryTitle(record, (value) => value.includes(normalizedQuery))) {
                buckets.phrasePrimaryTitle.push(record);
                return;
            }
            if (queryTokens.length > 1 && matchesPrimaryTitle(record, (value) => hasOrderedTokenMatch(value, queryTokens))) {
                buckets.orderedPrimaryTokens.push(record);
                return;
            }
            if (queryTokens.length > 1 && matchesPrimaryTitle(record, (value) => queryTokens.every((token) => value.includes(token)))) {
                buckets.allPrimaryTokens.push(record);
                return;
            }
            if (matchesVariantTitle(record, (value) => value === normalizedQuery)) {
                buckets.exactVariantTitle.push(record);
                return;
            }
            if (matchesVariantTitle(record, (value) => value.startsWith(normalizedQuery))) {
                buckets.prefixVariantTitle.push(record);
                return;
            }
            if (matchesVariantTitle(record, (value) => value.includes(normalizedQuery))) {
                buckets.phraseVariantTitle.push(record);
                return;
            }
            if (queryTokens.length > 1 && matchesVariantTitle(record, (value) => hasOrderedTokenMatch(value, queryTokens))) {
                buckets.orderedVariantTokens.push(record);
                return;
            }
            if (queryTokens.length > 1 && matchesVariantTitle(record, (value) => queryTokens.every((token) => value.includes(token)))) {
                buckets.allVariantTokens.push(record);
            }
        });

        return Object.fromEntries(
            Object.entries(buckets).map(([key, items]) => [key, sortJournalSearchRecords(items)])
        );
    }

    function collectDirectorySearchResults(records, rawQuery, config) {
        const normalizedQuery = normalizeText(rawQuery);
        const identifierQuery = compactIssn(rawQuery);
        const queryTokens = normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : [];
        const buckets = {
            exactIdentifier: [],
            exactText: [],
            prefixText: [],
            phraseText: [],
            orderedTokens: [],
            allTokens: [],
        };

        records.forEach((record) => {
            const textValues = uniqueValues(config.textValues(record)).map(normalizeText).filter(Boolean);
            const identifiers = uniqueValues(config.identifiers(record)).map(compactIssn).filter(Boolean);

            if (identifierQuery && identifiers.some((identifier) => identifier === identifierQuery)) {
                buckets.exactIdentifier.push(record);
                return;
            }
            if (!normalizedQuery) {
                return;
            }
            if (textValues.some((value) => value === normalizedQuery)) {
                buckets.exactText.push(record);
                return;
            }
            if (textValues.some((value) => value.startsWith(normalizedQuery))) {
                buckets.prefixText.push(record);
                return;
            }
            if (textValues.some((value) => value.includes(normalizedQuery))) {
                buckets.phraseText.push(record);
                return;
            }
            if (queryTokens.length > 1 && textValues.some((value) => hasOrderedTokenMatch(value, queryTokens))) {
                buckets.orderedTokens.push(record);
                return;
            }
            if (queryTokens.length > 1 && textValues.some((value) => queryTokens.every((token) => value.includes(token)))) {
                buckets.allTokens.push(record);
            }
        });

        const compare = config.compare;
        return mergeRecordGroups(
            ...Object.values(buckets).map((items) => [...items].sort(compare))
        );
    }

    async function ensureSearchIndexes() {
        if (state.primaryTitleSearchIndex && state.titleVariantSearchIndex && state.issnSearchIndex && state.recordById) {
            return {
                primaryTitle: state.primaryTitleSearchIndex,
                titleVariant: state.titleVariantSearchIndex,
                issn: state.issnSearchIndex,
            };
        }

        if (!state.searchIndexesPromise) {
            state.searchIndexesPromise = (async () => {
                const records = await loadRecords();
                const indexes = createSearchIndexes();
                if (!records || !indexes) {
                    return null;
                }

                const recordById = new Map();
                for (let index = 0; index < records.length; index += 1) {
                    const record = records[index];
                    recordById.set(record.id, record);

                    if (record.normalizedPrimaryTitle) {
                        indexes.primaryTitle.add(record.id, record.normalizedPrimaryTitle);
                    }
                    if (record.normalizedVariantTitles.length) {
                        indexes.titleVariant.add(record.id, record.normalizedVariantTitles.join(" "));
                    }
                    if (record.compactIssns.length) {
                        indexes.issn.add(record.id, record.compactIssns.join(" "));
                    }
                    if ((index + 1) % SEARCH_INDEX_BATCH_SIZE === 0) {
                        await yieldToBrowser();
                    }
                }

                state.primaryTitleSearchIndex = indexes.primaryTitle;
                state.titleVariantSearchIndex = indexes.titleVariant;
                state.issnSearchIndex = indexes.issn;
                state.recordById = recordById;
                return indexes;
            })().finally(() => {
                state.searchIndexesPromise = null;
            });
        }

        return state.searchIndexesPromise;
    }

    async function searchRecordsWithFlexSearch(rawQuery) {
        const indexes = await ensureSearchIndexes();
        if (!indexes || !state.recordById || !state.records) {
            return null;
        }

        const normalizedQuery = normalizeText(rawQuery);
        const issnQuery = compactIssn(rawQuery);
        const linearBuckets = collectLinearSearchBuckets(state.records, normalizedQuery, issnQuery);
        const searchLimit = state.records.length;
        const primaryTitleIds = normalizedQuery
            ? normalizeSearchIds(indexes.primaryTitle.search(normalizedQuery, searchLimit, { suggest: true }))
            : [];
        const titleVariantIds = normalizedQuery
            ? normalizeSearchIds(indexes.titleVariant.search(normalizedQuery, searchLimit, { suggest: true }))
            : [];
        const issnIds = issnQuery
            ? normalizeSearchIds(indexes.issn.search(issnQuery, searchLimit))
            : [];
        const orderedIds = mergeSearchIds(issnIds, primaryTitleIds, titleVariantIds);
        const flexRecords = orderedIds
            .map((id) => state.recordById.get(id))
            .filter(Boolean);

        return mergeRecordGroups(
            linearBuckets.exactIssn,
            linearBuckets.exactPrimaryTitle,
            linearBuckets.prefixPrimaryTitle,
            linearBuckets.phrasePrimaryTitle,
            linearBuckets.orderedPrimaryTokens,
            linearBuckets.allPrimaryTokens,
            linearBuckets.exactVariantTitle,
            linearBuckets.prefixVariantTitle,
            linearBuckets.phraseVariantTitle,
            linearBuckets.orderedVariantTokens,
            linearBuckets.allVariantTokens,
            flexRecords
        );
    }

    async function loadRecords() {
        if (state.records) {
            return state.records;
        }
        if (!state.recordsPromise) {
            state.recordsPromise = (async () => {
                if (!globalThis.ORBIT_SITE_ROWS) {
                    await loadScriptOnce(payload.recordsScriptUrl);
                }
                const rawRows = globalThis.ORBIT_SITE_ROWS;
                const journalRows = Array.isArray(rawRows) ? rawRows : rawRows && rawRows.journals;
                const conferenceRows = rawRows && Array.isArray(rawRows.conferences) ? rawRows.conferences : [];
                const publisherRows = rawRows && Array.isArray(rawRows.publishers) ? rawRows.publishers : [];
                if (!Array.isArray(journalRows)) {
                    throw new Error("ORBIT site records are missing.");
                }
                const hydratedRecords = journalRows.map(buildRecord);
                state.records = hydratedRecords;
                state.conferenceRecords = conferenceRows.map(buildConferenceRecord);
                state.publisherRecords = publisherRows.map(buildPublisherRecord);
                delete globalThis.ORBIT_SITE_ROWS;
                return hydratedRecords;
            })().finally(() => {
                state.recordsPromise = null;
            });
        }
        return state.recordsPromise;
    }

    async function loadConferenceRecords() {
        await loadRecords();
        return state.conferenceRecords || [];
    }

    async function loadPublisherRecords() {
        await loadRecords();
        return state.publisherRecords || [];
    }

    function showDataLoadError() {
        elements.resultsContainer.innerHTML = '<p class="text-red-600 my-4">Unable to load ORBIT data. Please try again.</p>';
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
        return renderExternalUrl(record.urls[0]);
    }

    function renderExternalUrl(url, label = "Click here") {
        if (!url) {
            return "N/A";
        }
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer" class="hyperlink">${escapeHtml(label)}${externalLinkIcon()}</a>`;
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
        const warningListMessage = "This indicates if the journal is listed in the Early Warning List published by the Chinese Academy of Sciences.";
        const warningListHtml = warningFlag
            ? `<p class="text-red-600 font-semibold"><strong>Warning List${infoIcon(warningListMessage)}:</strong> Yes</p>`
            : `<p><strong>Warning List${infoIcon(warningListMessage)}:</strong> No</p>`;

        contentWrapper.innerHTML = `
            <div class="space-y-2 text-sm text-gray-600 pt-3">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                    <div>
                        <p><strong class="lau-green">ORBIT Rank:</strong> <span class="lau-green font-semibold">${escapeHtml(formatDisplayValue(record.grade))}</span></p>
                        <p><strong>Elite Journal${infoIcon("This indicates if the journal is currently listed in the ARWU Shanghai, FT50, Nature Index, or UTD24 lists.")}:</strong> ${eliteStatus}</p>
                        ${warningListHtml}
                        <p><strong>Norwegian Level:</strong> ${escapeHtml(formatDisplayValue(record.ratingsMap.Norwegian))}</p>
                        <p><strong>JUFO Level:</strong> ${escapeHtml(formatDisplayValue(record.ratingsMap.JUFO))}</p>
                        ${otherRanksHtml}
                        <p><strong>Business Rankings${infoIcon("This indicates whether the entry is tagged for the business-oriented ranking signals available in ORBIT.")}:</strong> ${businessRanking}</p>
                        <p><strong>Uncertainty Score${infoIcon("This score quantifies the disagreement among the ranking systems. A low score (e.g., below 0.1) indicates a reliable grade based on strong consensus, while a high score reveals conflicting views.")}:</strong> ${uncertaintyScore}</p>
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

    function createConferenceCard(record) {
        const card = document.createElement("div");
        const uncertaintyScore = Number.isFinite(record.uncertainty) ? record.uncertainty.toFixed(4) : "N/A";
        card.className = "result-card bg-white rounded-lg shadow-md p-5";
        card.innerHTML = `
            <h3 class="text-xl font-bold text-gray-800 mb-3">${escapeHtml(record.displayName)}</h3>
            <div class="space-y-2 text-sm text-gray-600 pt-3">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                    <div>
                        <p><strong class="lau-green">ORBIT Rank:</strong> <span class="lau-green font-semibold">${escapeHtml(formatDisplayValue(record.grade))}</span></p>
                        <p><strong>Uncertainty Score${infoIcon("This score quantifies disagreement among the conference ranking sources. A lower score indicates stronger consensus.")}:</strong> ${escapeHtml(uncertaintyScore)}</p>
                        <p><strong>CORE Rank:</strong> ${escapeHtml(formatDisplayValue(record.coreRank))}</p>
                    </div>
                    <div>
                        <p><strong>JUFO Level:</strong> ${escapeHtml(formatDisplayValue(record.jufoLevel))}</p>
                        <p><strong>Norwegian Level:</strong> ${escapeHtml(formatDisplayValue(record.norwegianLevel))}</p>
                        <p><strong>ISSN(s):</strong> ${escapeHtml(formatDisplayValue(record.issns))}</p>
                    </div>
                </div>
            </div>
        `;
        return card;
    }

    function createPublisherCard(record) {
        const card = document.createElement("div");
        const reliabilityScore = Number.isFinite(record.reliability) && record.reliability > 0 ? record.reliability.toFixed(2) : "N/A";
        const aliasText = record.aliases.length > 1 ? record.aliases.slice(1).join(" | ") : "";
        card.className = "result-card bg-white rounded-lg shadow-md p-5";
        card.innerHTML = `
            <h3 class="text-xl font-bold text-gray-800 mb-3">${escapeHtml(record.displayName)}</h3>
            <div class="space-y-2 text-sm text-gray-600 pt-3">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                    <div>
                        <p><strong class="lau-green">ORBIT Publisher Grade:</strong> <span class="lau-green font-semibold">${escapeHtml(formatDisplayValue(record.grade))}</span></p>
                        <p><strong>Reliability Score${infoIcon("This score summarizes the agreement and reliability signals available for this publisher in the current ORBIT release.")}:</strong> ${escapeHtml(reliabilityScore)}</p>
                        <p><strong>JUFO Level:</strong> ${escapeHtml(formatDisplayValue(record.jufoLevel))}</p>
                        <p><strong>Norwegian Level:</strong> ${escapeHtml(formatDisplayValue(record.norwegianLevel))}</p>
                    </div>
                    <div>
                        <p><strong>Known Alias:</strong> ${escapeHtml(formatDisplayValue(aliasText))}</p>
                        <p><strong>Shared ISBN(s):</strong> ${escapeHtml(formatDisplayValue(record.sharedIsbns))}</p>
                        <p><strong>All ISBN(s):</strong> ${escapeHtml(formatDisplayValue(record.allIsbns))}</p>
                        <p><strong>Homepage:</strong> ${renderExternalUrl(record.url)}</p>
                    </div>
                </div>
            </div>
        `;
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
        if (state.conferenceSearchDebounceId !== null) {
            window.clearTimeout(state.conferenceSearchDebounceId);
            state.conferenceSearchDebounceId = null;
        }
        if (state.publisherSearchDebounceId !== null) {
            window.clearTimeout(state.publisherSearchDebounceId);
            state.publisherSearchDebounceId = null;
        }
    }

    function showJournalSearchPrompt() {
        state.activeMode = "journal";
        state.currentResults = [];
        clearSharedResults();
        elements.resultsContainer.innerHTML = '<p class="text-gray-600 italic my-4">Type a journal name or ISSN to search.</p>';
    }

    function showConferenceSearchPrompt() {
        state.activeMode = "conference";
        state.currentResults = [];
        clearSharedResults();
        elements.resultsContainer.innerHTML = '<p class="text-gray-600 italic my-4">Type a conference name or ISSN to search.</p>';
    }

    function showPublisherSearchPrompt() {
        state.activeMode = "publisher";
        state.currentResults = [];
        clearSharedResults();
        elements.resultsContainer.innerHTML = '<p class="text-gray-600 italic my-4">Type a publisher name or ISBN to search.</p>';
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

    function queueConferenceSearch({ immediate = false } = {}) {
        clearPendingJournalSearch();
        if (immediate) {
            void runConferenceSearch();
            return;
        }
        state.conferenceSearchDebounceId = window.setTimeout(() => {
            state.conferenceSearchDebounceId = null;
            void runConferenceSearch();
        }, 250);
    }

    function queuePublisherSearch({ immediate = false } = {}) {
        clearPendingJournalSearch();
        if (immediate) {
            void runPublisherSearch();
            return;
        }
        state.publisherSearchDebounceId = window.setTimeout(() => {
            state.publisherSearchDebounceId = null;
            void runPublisherSearch();
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
        const resultLabels = {
            journal: "journal",
            filter: "result",
            conference: "conference",
            publisher: "publisher",
        };
        const totalResults = Math.max(state.currentResultsTotal, state.currentResults.length);

        if (!isLoadMore) {
            elements.resultsContainer.innerHTML = "";
            elements.paginationContainer.innerHTML = "";
            state.currentOffset = 0;

            const statusMessage = document.createElement("p");
            statusMessage.className = "text-gray-600 italic my-4";
            const label = resultLabels[state.activeMode] || "result";
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
            let card;
            if (isFilterSearch) {
                card = createFilterListItem(record, listContainer);
            } else if (state.activeMode === "conference") {
                card = createConferenceCard(record);
            } else if (state.activeMode === "publisher") {
                card = createPublisherCard(record);
            } else {
                card = createJournalCard(record);
            }
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

        const flexSearchResults = await searchRecordsWithFlexSearch(rawQuery);
        if (requestToken !== state.journalSearchRequestToken) {
            return;
        }
        state.activeMode = "journal";

        if (flexSearchResults !== null) {
            state.currentResults = flexSearchResults;
            state.currentResultsTotal = flexSearchResults.length;
            state.loadMoreResults = null;
            await displayResults();
            return;
        }

        const records = await ensureRecords(null, "Loading journal data...");
        if (requestToken !== state.journalSearchRequestToken || !records) {
            return;
        }

        const query = normalizeText(rawQuery);
        const issnQuery = compactIssn(rawQuery);
        const linearBuckets = collectLinearSearchBuckets(records, query, issnQuery);

        state.currentResults = mergeRecordGroups(
            linearBuckets.exactIssn,
            linearBuckets.exactPrimaryTitle,
            linearBuckets.prefixPrimaryTitle,
            linearBuckets.phrasePrimaryTitle,
            linearBuckets.orderedPrimaryTokens,
            linearBuckets.allPrimaryTokens,
            linearBuckets.exactVariantTitle,
            linearBuckets.prefixVariantTitle,
            linearBuckets.phraseVariantTitle,
            linearBuckets.orderedVariantTokens,
            linearBuckets.allVariantTokens
        );
        state.currentResultsTotal = state.currentResults.length;
        state.loadMoreResults = null;

        if (requestToken !== state.journalSearchRequestToken) {
            return;
        }

        await displayResults();
    }

    async function runConferenceSearch() {
        const rawQuery = elements.conferenceInput.value.trim();
        const requestToken = state.journalSearchRequestToken + 1;
        state.journalSearchRequestToken = requestToken;

        if (!rawQuery) {
            showConferenceSearchPrompt();
            return;
        }

        state.activeMode = "conference";
        elements.resultsContainer.innerHTML = '<p class="text-gray-600 italic my-4">Searching conferences...</p>';
        elements.paginationContainer.innerHTML = "";

        try {
            const records = await loadConferenceRecords();
            if (requestToken !== state.journalSearchRequestToken) {
                return;
            }

            state.currentResults = collectDirectorySearchResults(records, rawQuery, {
                textValues: (record) => [record.name],
                identifiers: (record) => record.issns,
                compare: (left, right) => gradeValue(right.grade) - gradeValue(left.grade)
                    || left.uncertainty - right.uncertainty
                    || left.name.localeCompare(right.name),
            });
            state.currentResultsTotal = state.currentResults.length;
            state.loadMoreResults = null;
            await displayResults();
        } catch (error) {
            console.error(error);
            showDataLoadError();
        }
    }

    async function runPublisherSearch() {
        const rawQuery = elements.publisherSearchInput.value.trim();
        const requestToken = state.journalSearchRequestToken + 1;
        state.journalSearchRequestToken = requestToken;

        if (!rawQuery) {
            showPublisherSearchPrompt();
            return;
        }

        state.activeMode = "publisher";
        elements.resultsContainer.innerHTML = '<p class="text-gray-600 italic my-4">Searching publishers...</p>';
        elements.paginationContainer.innerHTML = "";

        try {
            const records = await loadPublisherRecords();
            if (requestToken !== state.journalSearchRequestToken) {
                return;
            }

            state.currentResults = collectDirectorySearchResults(records, rawQuery, {
                textValues: (record) => [record.name, ...record.aliases],
                identifiers: (record) => record.allIsbns,
                compare: (left, right) => gradeValue(right.grade) - gradeValue(left.grade)
                    || right.reliability - left.reliability
                    || left.name.localeCompare(right.name),
            });
            state.currentResultsTotal = state.currentResults.length;
            state.loadMoreResults = null;
            await displayResults();
        } catch (error) {
            console.error(error);
            showDataLoadError();
        }
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
        state.activeMode = nextTab;
        state.currentResults = [];
        clearSharedResults();

        const tabs = {
            journal: { button: elements.tabJournalSearch, panel: elements.panelJournalSearch },
            conference: { button: elements.tabConferenceSearch, panel: elements.panelConferenceSearch },
            publisher: { button: elements.tabPublisherSearch, panel: elements.panelPublisherSearch },
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
            state.aboutReady = true;
        }

        if (nextTab === "journal") {
            if (elements.journalInput.value.trim()) {
                queueJournalSearch({ immediate: true });
            } else {
                showJournalSearchPrompt();
            }
        }
        if (nextTab === "conference") {
            if (elements.conferenceInput.value.trim()) {
                queueConferenceSearch({ immediate: true });
            } else {
                showConferenceSearchPrompt();
            }
        }
        if (nextTab === "publisher") {
            if (elements.publisherSearchInput.value.trim()) {
                queuePublisherSearch({ immediate: true });
            } else {
                showPublisherSearchPrompt();
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

        elements.aboutSummaryStats.textContent = `The grade distribution is based on ${formatNumber(payload.stats.gradedEntries)} journals ranked by ORBIT, excluding ${formatNumber(payload.stats.unrankedEntries)} unranked titles. The updated release maps ${formatNumber(payload.stats.asjcCount)} distinct ASJC classes, plus ${formatNumber(payload.stats.conferenceEntries)} conferences and ${formatNumber(payload.stats.publisherEntries)} publishers in separate search tabs.`;
    }

    function renderFaqSection(container, items) {
        if (!container) {
            return;
        }
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

    function switchAboutTab(nextTab) {
        const aboutTabs = {
            journals: { button: elements.aboutTabJournals, panel: elements.aboutPanelJournals },
            conferences: { button: elements.aboutTabConferences, panel: elements.aboutPanelConferences },
            publishers: { button: elements.aboutTabPublishers, panel: elements.aboutPanelPublishers },
        };

        Object.values(aboutTabs).forEach(({ button, panel }) => {
            if (button) {
                button.classList.remove("active");
            }
            if (panel) {
                panel.classList.add("hidden");
            }
        });

        const selected = aboutTabs[nextTab];
        if (!selected) {
            return;
        }
        selected.button.classList.add("active");
        selected.panel.classList.remove("hidden");
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
        elements.conferenceInput.addEventListener("input", () => {
            if (state.activeTab !== "conference") {
                return;
            }
            queueConferenceSearch();
        });
        elements.conferenceInput.addEventListener("keyup", (event) => {
            if (event.key === "Enter") {
                queueConferenceSearch({ immediate: true });
            }
        });
        elements.publisherSearchInput.addEventListener("input", () => {
            if (state.activeTab !== "publisher") {
                return;
            }
            queuePublisherSearch();
        });
        elements.publisherSearchInput.addEventListener("keyup", (event) => {
            if (event.key === "Enter") {
                queuePublisherSearch({ immediate: true });
            }
        });
        elements.clearSearchBtn.addEventListener("click", () => {
            clearPendingJournalSearch();
            state.journalSearchRequestToken += 1;
            elements.journalInput.value = "";
            showJournalSearchPrompt();
            elements.journalInput.focus();
        });
        elements.clearConferenceSearchBtn.addEventListener("click", () => {
            clearPendingJournalSearch();
            state.journalSearchRequestToken += 1;
            elements.conferenceInput.value = "";
            showConferenceSearchPrompt();
            elements.conferenceInput.focus();
        });
        elements.clearPublisherSearchBtn.addEventListener("click", () => {
            clearPendingJournalSearch();
            state.journalSearchRequestToken += 1;
            elements.publisherSearchInput.value = "";
            showPublisherSearchPrompt();
            elements.publisherSearchInput.focus();
        });

        elements.filterBtn.addEventListener("click", () => {
            void runFilterSearch();
        });
        elements.resetBtn.addEventListener("click", resetFilterPanel);

        elements.tabJournalSearch.addEventListener("click", () => switchTab("journal"));
        elements.tabConferenceSearch.addEventListener("click", () => switchTab("conference"));
        elements.tabPublisherSearch.addEventListener("click", () => switchTab("publisher"));
        elements.tabFilterSearch.addEventListener("click", () => switchTab("filter"));
        elements.tabAbout.addEventListener("click", () => switchTab("about"));
        elements.tabFaq.addEventListener("click", () => switchTab("faq"));
        elements.tabContact.addEventListener("click", () => switchTab("contact"));
        elements.aboutTabJournals.addEventListener("click", () => switchAboutTab("journals"));
        elements.aboutTabConferences.addEventListener("click", () => switchAboutTab("conferences"));
        elements.aboutTabPublishers.addEventListener("click", () => switchAboutTab("publishers"));
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

        renderFaqSection(elements.faqConferences, [
            {
                question: "What is ORBIT for conferences in one sentence?",
                answer: `ORBIT turns CORE, JUFO, and the Norwegian Register tiers into 0-100 scores, weights the systems by reliability, averages what is available (requiring at least two systems), and maps the result to a letter grade from A+ to D; Elite flags force A+.`,
            },
            {
                question: "What does the uncertainty score mean?",
                answer: `It is a simple confidence indicator. A low value close to 0 means the ranking systems agree with each other and/or place the conference near the top tiers. A high value close to 1 means the systems disagree, the conference is far from the top tiers, or the available evidence is limited. The uncertainty is reported on a normalized 0-1 scale to make comparisons across conferences easy and consistent.`,
            },
            {
                question: "How is the uncertainty score computed in plain English?",
                answer: `It combines two ingredients:<ul class="list-disc pl-5 mt-2"><li><strong>Spread:</strong> how far apart the 0-100 scores from CORE, JUFO, and the Norwegian system are.</li><li><strong>Tier gap:</strong> on average, how far the assigned tiers are from the very top tier.</li></ul>These pieces are blended into a single value and normalized to a 0-1 range so typical conferences do not appear artificially extreme.`,
            },
            {
                question: "Does uncertainty change my grade?",
                answer: `No. The letter grade from A+ to D comes from the weighted score plus any Elite override. Uncertainty is advisory; it helps you judge confidence and compare venues with the same grade.`,
            },
            {
                question: "When does uncertainty go up because of missing data?",
                answer: `We do not increase uncertainty when the only available systems are JUFO and the Norwegian Register. We add a small uncertainty bump only when a conference has CORE plus exactly one other system, because the evidence is thinner than when all three systems are available.`,
            },
            {
                question: "What is a good uncertainty score?",
                answer: `As a rule of thumb on the 0-1 scale:<ul class="list-disc pl-5 mt-2"><li><strong>0.00-0.25:</strong> very consistent evidence.</li><li><strong>0.25-0.55:</strong> normal or typical uncertainty.</li><li><strong>0.55-0.80:</strong> higher uncertainty, worth checking for disagreement across systems.</li><li><strong>0.80-1.00:</strong> very high uncertainty, usually strong disagreement or limited evidence.</li></ul>Lower is always better: a smaller uncertainty score means greater confidence in the assigned ORBIT grade.`,
            },
            {
                question: "Why do some Elite conferences still show noticeable uncertainty?",
                answer: `Elite only affects the grade by forcing A+. If the three systems disagree on tiers, or evidence is thin, the spread and tier gap can still produce a non-trivial uncertainty score. That transparency is intentional.`,
            },
            {
                question: "Why are A+ grades concentrated in computer-science-related conferences?",
                answer: `ORBIT reflects real differences in how conferences operate across disciplines. In computer-science-related fields, a small number of flagship conferences run highly competitive, journal-like peer review, with very low acceptance rates and strong community consensus on venue prestige. In most other fields, journals remain the primary venue for definitive research, so ORBIT is intentionally conservative with A+ conference grades outside computer-science-related fields.`,
            },
            {
                question: "How is ORBIT for conferences different from ORBIT for journals?",
                answer: `<ul class="list-disc pl-5"><li><strong>Reliability and aggregation:</strong> Journals use an external ground truth from Elite and Warning lists to compute system reliability and a pessimistic dual-weight average. Conferences learn reliability from Elite rows and use a single reliability-weighted average.</li><li><strong>Uncertainty and penalties:</strong> Journals rely on a weighted variance-style disagreement. Conferences use a hybrid spread plus tier-gap measure with a conditional penalty only for CORE plus one other system.</li></ul>`,
            },
        ]);

        renderFaqSection(elements.faqPublishers, [
            {
                question: "How should I interpret publisher grades?",
                answer: `Publisher grades mirror the journal rubric but are built from the overlap between the Finnish JUFO list and the Norwegian Register. A+ is reserved for the strongest joint endorsement, A and B capture high-quality overlap, C is the broad recognized mainstream tier, and D is the lowest graded tier. A D grade is not by itself a misconduct label; it means weak overlap-based evidence of high standing.`,
            },
            {
                question: "What exactly are we ranking here?",
                answer: `Scholarly book and monograph publishers only. This does not rank journals or conference outlets. Think university presses and specialist academic houses that publish peer-reviewed books.`,
            },
            {
                question: "What data do we use?",
                answer: `Two independent national publisher lists classify scholarly book publishers by level. ORBIT uses these as external signals of quality and peer review.`,
            },
            {
                question: "How are grades assigned?",
                answer: `Grades are assigned with a strict overlap rubric across the two lists. A+ means top level on both lists; A means top on one list and high on the other; B means mid/high combinations; C means credible but not high on either list; D means present but weak or uncertain. The rule is intentionally conservative and easy to audit.`,
            },
            {
                question: "Do the 0-100 scores still matter?",
                answer: `Only for context. ORBIT computes simple percentile-style scores per level to show where a level sits in the current data and to compute a disagreement metric. Letter grades come from the overlap rubric, not from those scores.`,
            },
            {
                question: "How do you treat imprints, mergers, and series?",
                answer: `Imprints are kept when they have distinct editorial control; otherwise they are rolled up to the parent. Mergers and renames are mapped to the current entity with a note. Book series are not ranked as publishers; ORBIT ranks the publisher behind the series.`,
            },
            {
                question: "What about fields, languages, and edited volumes?",
                answer: `ORBIT focuses on peer-reviewed scholarly monographs and edited volumes; trade and popular books are out. National lists can favor certain languages or regions, so the overlap of two lists helps reduce single-list bias.`,
            },
        ]);

        attachFaqEvents();
        bindEvents();
        switchTab("journal");
    }

    init();
})();
