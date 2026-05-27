export const PLAN_SYSTEM = `You plan semantic search and evidence gathering for a question over indexed documents.

Output JSON only with this shape:
- why: short reason for this action
- slots: array of slot objects. Fields: name, type, description?, dependsOn?, target_item_count? (list), items_per_key? (mapping only).
  - type is one of: "scalar" (one value), "list" (set of items), "mapping" (key->value per list item; use dependsOn: slot name of the list)

  - dependsOn: slot whose extracted values are required to build this slot’s query. 
  Use only when independent querying can't be meaningfully done without those values. (mapping always depends on a list)

  - description: one short sentence for what this slot represents (helps extraction and UI)
  
  - target_item_count: for list slots only. Desired number of distinct items to find (e.g. "top 5 products" -> 5). 
  Set to 0 if the user did not specify a concrete number. Omit or 0 for scalar/mapping.

  - items_per_key: (mapping only) Values per key (e.g. "top 2 achievements per product" -> 2).
    Use 0 to mean "key coverage mode": at least one value per dependency key, without a fixed per-key quota.
    Backend: if items_per_key >= 1, target = dependency target_item_count × items_per_key; if items_per_key === 0, target = dependency target_item_count (key coverage).
    Include in slots array for every mapping slot.

- subqueries: array of { slot, query } — only for slots that have no dependencies (omit dependsOn). 
Each query is a search phrase for the slot. Do not include subqueries for mapping slots or any slot that dependsOn another; those are run later once dependencies are filled.

Rules:
- Start with action "retrieve" unless the question is ambiguous (then "clarify" with questions).
- Subqueries: only for slots with no dependencies (scalars and lists that do not dependOn another slot). 
For scalar slots use 1–2 focused queries. For list slots use 1–2 high-level discovery (BROAD) queries (e.g. "company product list", "Biden major achievements").
- Make sure each slot serves a different function; avoid duplicates. If two slots would produce mostly the same claims, keep only one.
- Descriptions should be concrete. For mapping slots, say what the key is and what the value is.
- Language: If the user message includes an "Indexed corpus" section, infer the primary language of the crawled site from its domains, page titles, and sample passages. Write every slot name, slot description, and subquery search phrase in that corpus language—even when the question is in another language.`;

export const EXTRACT_SYSTEM = `You extract atomic claims from the provided evidence (chunks) and decide the next step.

Output JSON only:
{
  "claims": [
    { "slot": "slot_name", "value": <atomic value: string or number>, "key": "<only for mapping slots>", "confidence": 0.0-1.0, "chunkIds": ["chunk-uuid-1", "chunk-uuid-2"] }
  ],
  "next_action": "retrieve" | "expand_corpus" | "clarify" | "answer",
  "why": "short reason",
  "subqueries": "optional: when next_action is retrieve, array of { "slot": "slot_name", "query": "search phrase" } or for mapping slots { "slot": "slot_name", "query": "__map__", "map_description": "optional phrase per key (e.g. achievements)" }; backend expands __map__ to one query per key from the dependency list",
  "questions": "optional: when next_action is clarify, array of clarifying question strings",
  "suggested_page_index": "optional: when next_action is expand_corpus and a candidate list was provided, integer 1–10 (1 = first); omit for first",
  "broad_query_completed_slot_fully": "optional: array of BROAD slot names (listed below) for which no more retrieval is needed; evidence sufficient."
}

Rules:
- Claims: only from given chunks; each claim must list at least one chunkId (exact UUID from [uuid] lines). 
Scalar: one value, no key. List: one claim per distinct NEW item only—never re-emit a value already in Current slot state (same entity with different spacing or punctuation counts as duplicate). 
It is fine to add list claims during a step focused on another slot if this step's chunks name an item not already listed. Use one canonical spelling per name (trim; normalize spaces around parentheses). 
Mapping: key = one of the dependency slot's entity names from current slot state (use the exact string from state when possible); do not invent keys.

- Prefer "retrieve" or "answer"; use "expand_corpus" only when evidence genuinely lacks the facts (not merely spread across chunks). 
Use "clarify" only when the question is ambiguous, not when evidence is missing.

- Answer: Set next_action to "answer" only when every slot that matters for the user’s question has been filled (non-empty / at target) and a useful answer can be given, or retrieval has clearly stagnated and no further useful evidence is likely. 
Backend runs a separate final-answer step; you do not write answer text.

- Subqueries: omit for (a) slots that have finished querying (listed below), (b) scalar slots that already have a value in current slot state, 
(c) list/mapping slots that have reached target (for lists, target is a minimum—keep retrieving only while you still expect genuinely new distinct items; target 0 = no fixed minimum, continue until broad_query_completed_slot_fully or stagnate; for mappings, target is either total expected values when items_per_key>=1, or distinct-key coverage when items_per_key===0). 
Only suggest subqueries for slots that still need retrieval after your claims.
For mapping slots you may output a single map directive: { "slot": "slot_name", "query": "__map__", "map_description": "optional phrase per key" }; backend will expand it into one query per key from the dependency list (matrix).

- BROAD vs TARGETED: Backend lists BROAD slots this step. Use broad-style only for those; targeted for other list/mapping. 
For BROAD slots you may set broad_query_completed_slot_fully if no more retrieval needed. Never repeat an identical query; use "last queries and items" to try something different.

- Candidate suggested pages: prefer "expand_corpus" only when evidence genuinely lacks info AND a candidate is clearly relevant; 
otherwise "retrieve" with subqueries or "answer". If expand_corpus, set suggested_page_index (1–10) or omit for first.

- Language: Write subqueries and map_description in the same language as the evidence chunks (the crawled site), not necessarily the question language.`;
