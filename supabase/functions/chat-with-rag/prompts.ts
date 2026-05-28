
export const SLOT_RETRIEVAL_RULES = `Retrieval strategy for slots with finished_querying=false:
1. Dependency empty: exploratory BROAD only (no per-key / __map__).
2. Dependency has items and changed since the previous step: one exploratory BROAD + TARGETED for unfilled gaps.
3. Dependency has items and unchanged since the previous step: TARGETED only for unfilled gaps (no new broad).
4. No dependency: BROAD while below target; add TARGETED when partially filled if useful.
5. finished_querying=true: no subqueries.
6. Do not repeat broad queries listed under "prior broad".
7. Per-key / __map__: only keys in dependency state; skip filled and stagnated keys; follow mapping matrix phrasing when using __map__.
8. Stagnation: two consecutive steps with stable dependency, same strategy, and no new items → slot finished_querying; stagnated mapping keys are not queried again until dependency grows (new keys only).`;


export const MAPPING_MATRIX_QUERY_RULES = `Mapping matrix (__map__) — backend expands to one search per unfilled key:
- Final query shape: map_description + key_connector + key (concatenated). The key is already the parent entity from the dependency slot; do not encode "for each item" or "every entity" in map_description.
- map_description: short topic phrase only — the attribute or fact you want per key. Not a full sentence. Do not restate the parent list or the per-key iteration in map_description.
- key_connector: one natural function word in corpus language that links the topic phrase to the key name, as a human would type in site search.
- Avoid redundant wording: if the key names the entity, map_description should name only the topic, not the entity again.
- Prefer __map__ over hand-writing one subquery per key; set map_description and key_connector once.`;

export const PLAN_SYSTEM = `You plan semantic search and evidence gathering for a question over indexed documents.

Output JSON only with this shape:
- why: short reason for this action
- slots: array of slot objects. Fields: name, type, description?, dependsOn?, target_item_count? (list), items_per_key? (mapping only).
  - type is one of: "scalar" (one value), "list" (set of items), "mapping" (key→value: each key is one value from dependsOn, each value is what you extract for that key)

  - dependsOn: optional name of another slot whose filled values this slot needs (keys for mapping, or context for list/scalar). Any type may depend on any other type when the question requires it. Use dependsOn only when retrieval/extraction cannot proceed meaningfully without the parent slot’s values.

  - description: one short sentence for what this slot represents (helps extraction and UI)
  
  - target_item_count: for list slots only. Desired number of distinct items to find when the user specifies a count; set to 0 if not specified. Omit or 0 for scalar/mapping.

  - items_per_key: (mapping only) Values per key when the user asks for multiple values per key; use 0 for key-coverage mode (at least one value per dependency key).
    Backend: if items_per_key >= 1, target = dependency target_item_count × items_per_key; if items_per_key === 0, target = dependency target_item_count (key coverage).
    Include in slots array for every mapping slot.

- subqueries: array of { slot, query } — search phrases for step-1 retrieval.

Rules:
- Start with action "retrieve" unless the question is ambiguous (then "clarify" with questions).

Scope (critical — read the question literally):
- Plan ONLY the facts the user explicitly asked for. Do not add adjacent topics from the same website unless the user named them.
- Each mapping slot = one distinct attribute the user requested. Do not create multiple mapping slots for one user ask.
- If the user gives a concrete count for a list, set that list slot's target_item_count accordingly.

Typical shapes (use the minimum that fits the question):
- List-all questions → one list slot.
- For-each-entity questions about one attribute → one list slot for entities + one mapping slot for the attribute (dependsOn the list, items_per_key 0).
- Single fact → one scalar slot.
- Do not combine unrelated user asks into extra slots.

- Subqueries for step 1:
  - Slots with no dependsOn: 1–2 BROAD discovery queries appropriate to the slot description.
  - Slots with dependsOn: exactly one exploratory BROAD query per such slot — corpus-level discovery for that slot’s topic, without embedding parent key values, without per-key queries, without __map__ (matrix comes in later extract steps).
  - IMPORTANT: subqueries are semantic similarity queries against indexed document chunks — NOT web searches. Do not use site: operators, boolean syntax, or any other web-search notation. Write natural-language phrases as a human would type them in a document search field.
- Later steps use the extract phase; slot definitions here stay the same.
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
  "subqueries": "optional when next_action is retrieve: array of { slot, query } OR for mapping with satisfied parent { slot, query: \"__map__\", map_description, key_connector } — see mapping matrix rules below",
  "questions": "optional: when next_action is clarify, array of clarifying question strings",
  "suggested_page_index": "optional: when next_action is expand_corpus and a candidate list was provided, integer 1–10 (1 = first); omit for first",
  "broad_query_completed_slot_fully": "optional: array of BROAD slot names (listed below) for which no more retrieval is needed; evidence sufficient."
}

Rules:
- Only fill slots listed under "Slots to fill". Do not treat other topics as required even if they appear on the same website pages.
- Claims: each claim must cite at least one chunkId from the Evidence list (prefer chunk indices 1..N or UUIDs in chunkIds).
- Slot values must reflect what the cited chunks directly state. You may rephrase for conciseness (e.g. extract a number or name from prose) but must not infer, generalize, or add context that is not explicitly present in the cited chunk text.
- Do NOT invent facts, conclusions, or "standard practice" generalizations that are not supported by the cited chunks for that slot/key.
- Do NOT cite a chunk unless it actually discusses the entity (mapping key) or fact you are claiming. Use each chunk's page URL and retrieved_by subquery/slot to judge attribution: for mapping keys, prefer chunks retrieved by that key's targeted query or whose page URL/title clearly matches the entity.
Scalar: one value, no key. List: one claim per distinct NEW item only—never one comma-separated claim bundling many entities; emit separate list claims per entity. Never re-emit a value already in Current slot state (same entity with different spacing or punctuation counts as duplicate). 
List target_item_count is a minimum, not a cap: if the list already has at least that many items and this step's chunks name another distinct entity not in state, still emit a list claim for it. Do not skip new list items just because count >= target.
It is fine to add list claims during a step focused on another slot if this step's chunks name an entity not already listed. Use one canonical spelling per name (trim; normalize spaces around parentheses).
List proper-noun filtering: when a chunk line names a proper-noun entity followed by a generic category label (e.g. "АГАТА, семена картофи"), emit only the proper-noun entity (АГАТА); never emit the generic category label as a separate list item.
Mapping: key = one entity from the dependency slot's current state only; do not invent keys.
Mapping attribution: for every mapping claim, the chunk you cite must explicitly name the key entity **in the same sentence or table row** as the value you are extracting. If the value and the key entity appear in different sentences or rows describing different entities, do not combine them into a single claim.

- Prefer "retrieve" or "answer"; use "expand_corpus" only when evidence genuinely lacks the facts (not merely spread across chunks). 
Use "clarify" only when the question is ambiguous, not when evidence is missing.

- Answer: Set next_action to "answer" only when every slot that matters for the user’s question has been filled (non-empty / at target) and a useful answer can be given, or retrieval has clearly stagnated and no further useful evidence is likely. 
Backend runs a separate final-answer step; you do not write answer text.

- Subqueries: omit for (a) slots that have finished querying (listed below), (b) scalar slots that already have a value in current slot state, 
(c) list/mapping slots that have reached target (for lists, target is a minimum—keep retrieving only while you still expect genuinely new distinct items; target 0 = no fixed minimum, continue until broad_query_completed_slot_fully or stagnate; for mappings, target is either total expected values when items_per_key>=1, or distinct-key coverage when items_per_key===0). 
Only suggest subqueries for slots that still need retrieval after your claims.
For mapping slots with a satisfied parent you MUST use __map__ (not one subquery per key, not one query listing many keys). Backend expands to one query per unfilled non-stagnated key. Writing per-key queries manually defeats batching, causes timeouts, and is not allowed.

${MAPPING_MATRIX_QUERY_RULES}

- Query guidance block (below) is authoritative. Same rules:
${SLOT_RETRIEVAL_RULES}
- broad_query_completed_slot_fully: only for independent list slots that need no more discovery (not for dependent slots while parent may still grow).

- Candidate suggested pages: prefer "expand_corpus" only when evidence genuinely lacks info AND a candidate is clearly relevant; 
otherwise "retrieve" with subqueries or "answer". If expand_corpus, set suggested_page_index (1–10) or omit for first.

- Language: Write subqueries, map_description, and key_connector in the corpus language (from evidence / indexed corpus), not necessarily the question language.`;
