# Contract Manager — LIT Hackathon 2.0

An AI-powered contract intelligence web app: bulk-upload signed agreements (including scanned documents), automatically extract key terms with page-level citations, score confidence, detect conflicts (statutory, cross-contract, internal), and visualise deadlines on a calendar.

---

## What it does

| Capability | Detail |
|---|---|
| Bulk upload | Drag & drop up to ~80 documents at once (PDF, DOCX, TXT). Uploads are chunked (5 files per request) with live per-file status. |
| Scanned document OCR | Image-only PDFs are OCR'd page-by-page with Tesseract; if Tesseract is unavailable the AI model reads the page images directly (vision path). |
| AI extraction | Contract name, type, parties (with roles), start/end dates, deliverables (with descriptions), and key facts & terms — extracted by Gemini 2.5 Flash via OpenRouter, returned as strict JSON. |
| Citations | Every extracted field carries page number, paragraph number, clause identifier and a verbatim quote. Citations are hyperlinks that open a source viewer showing the exact page with the quoted snippet highlighted. |
| Found vs Inferred | Every field is tagged `FOUND` (explicitly stated, backed by a quote) or `INFERRED` (deduced by the model). |
| Terms matrix | Per-contract table: Party 1 / Party 2 / Confidence columns × 7 rows (Parties, Term, Renewal & Notice, Termination, Payment, Liability Caps, Exclusivity). Terms that apply equally to both parties are merged into a single MUTUAL cell. |
| Confidence scoring | Rows are HIGH or LOW confidence. LOW is triggered by ambiguous wording, potential conflicts with Singapore law / regulator guidance, conflicts with other contracts in the database (e.g. overlapping exclusivity), or internal contradictions (defined terms vs operating clauses). |
| Conflict pop-ups | Clicking a LOW flag opens a structured explanation: for statutes — the act, section and a link (Singapore Statutes Online, MOM, IRAS, ACRA, PDPC); for cross-contract clashes — the conflicting contract quoted, with a button to open it; for internal clashes — both clashing clauses cited side-by-side with links to the source pages. Every pop-up ends with an actionable renegotiation recommendation. |
| Issue categories | All Contracts tab: filter by "Clash with the law", "Clash with other contracts", "Internal clash" or "No issue"; cards display issue badges naming the specific statute or clause pair. |
| Calendar | Month/week/day views of start dates, end dates and deliverable deadlines; deliverables sorted by deadline with citations. |

---

## Architecture

```
┌────────────────────────────── Browser (SPA, vanilla JS) ──────────────────────────────┐
│  Dashboard │ Upload (drag&drop, chunked) │ Calendar + Terms Matrix │ All Contracts     │
└──────────────┬───────────────────────────────────────────────────────────┬────────────┘
               │ REST (JSON, multipart)                                    │ citations
               ▼                                                           ▼
┌───────────────────────────── Flask backend (Python) ─────────────────────────────────┐
│  /api/upload_multiple  /api/contracts  /api/calendar  /api/stats  /api/matrix/<id>   │
│  /api/reprocess  /api/delete  /api/page_image  /viewer  (static frontend)            │
│                                                                                      │
│  ┌── Extraction pipeline (per document) ─────────────────────────────────────┐       │
│  │ 1. Text layer   PyMuPDF (PDF pages + [[PAGE n]]/[[Pn]] markers)           │       │
│  │                 python-docx (paragraphs & tables, paragraph markers)      │       │
│  │ 2. OCR fallback Tesseract 5.4 via pytesseract (image-only pages, 300 dpi) │       │
│  │ 3. AI pass      Gemini 2.5 Flash via OpenRouter (temp 0, strict JSON)     │       │
│  │                 prompt carries page/paragraph markers -> field citations  │       │
│  │ 4. Normalise    dates -> ISO, citations validated, basis found/inferred,  │       │
│  │                 statute URLs whitelisted to sso/mom/iras/acra/pdpc        │       │
│  │ 5. Fallback     regex extractor (works with no API key / no network)      │       │
│  └───────────────────────────────────────────────────────────────────────────┘       │
│                                                                                      │
│  Matrix pass  /api/matrix/<id> : current contract + summaries of ALL other contracts │
│  -> per-row confidence, statute check, cross-contract exclusivity check,             │
│     internal definitions-vs-usage check; results cached on the record                │
│                                                                                      │
│  Source viewer  /viewer + /api/page_image : PyMuPDF renders the page at 150 dpi and  │
│  draws a translucent highlight over the exact quoted text (page.search_for)          │
└──────────────┬───────────────────────────────────────────────┬───────────────────────┘
               ▼                                               ▼
      contracts.json (document store)                  uploads/ (original files)
```

**Data model (per contract record in `contracts.json`):** `id`, `filename`, `filepath`, `contract_name`, `contract_type`, `parties[]`, `party_details[]` (name, role, basis, citation), `start_date`, `end_date`, `deliverables[]`, `deliverable_details[]` (date, description, basis, citation), `field_citations{}` (per scalar field), `facts[]` (term, value, confidence, basis, page, paragraph, clause, quote), `matrix{party1, party2, rows[7]}`, `extraction_method` (ai / ai_vision / regex), `uploaded_at`, `text`.

---

## Tech stack

- **Backend:** Python 3.13, Flask 3 + flask-cors (REST API, static hosting, server-side page rendering)
- **Document processing:** PyMuPDF (`pymupdf`) for PDF text/renders/search, `python-docx` for Word, Tesseract 5.4 + `pytesseract` for OCR, Pillow for image compositing
- **AI:** OpenRouter API (`google/gemini-2.5-flash`) — structured JSON extraction at temperature 0, two specialised prompts (field extraction + conflict matrix). Graceful regex fallback when AI is unavailable.
- **Frontend:** vanilla HTML/CSS/JavaScript (no framework), FullCalendar.js, Font Awesome
- **Storage:** `contracts.json` file as a lightweight document store (no DB server needed — a deliberate hackathon choice); `uploads/` holds original files so every citation can link back to source

---

## Running it

```bash
# 1. Python deps
pip install -r backend/requirements.txt

# 2. Tesseract OCR (Windows installer: UB-Mannheim build)
#    default path expected: C:\Program Files\Tesseract-OCR\tesseract.exe

# 3. AI key - backend/config.json
{ "openrouter_api_key": "sk-or-v1-...", "openrouter_model": "google/gemini-2.5-flash" }
#    (or set OPENROUTER_API_KEY env var; app still works without a key via regex fallback)

# 4. Start
cd backend
python app.py          # serves API + frontend on http://localhost:5000
```

Optional: `python generate_contracts.py` creates 20 realistic sample contracts in `sample_contracts/` (8 text PDFs, 7 DOCX, 5 image-only "scanned" PDFs) for demoing.

---

## API summary

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/upload_multiple` | Chunked bulk upload + AI processing |
| POST | `/api/upload` | Single-file upload |
| GET | `/api/contracts` | All records (sorted by deadline) |
| GET | `/api/contracts/<id>` | Single record |
| GET | `/api/calendar` | Start/end/deliverable events |
| GET | `/api/stats` | Dashboard aggregates |
| GET/POST | `/api/matrix/<id>` | Get or (re)generate the conflict-checked terms matrix |
| POST | `/api/reprocess` | Re-run AI extraction over every stored contract |
| DELETE | `/api/delete/<id>` | Remove a contract |
| GET | `/api/page_image/<file>/<page>?q=<quote>` | Page render with quoted text highlighted |
| GET | `/viewer?file=&page=&q=&clause=&para=&name=` | Source viewer page |

---

## Known limitations

- `contracts.json` is a single-writer file store — fine for a demo, not for concurrent production use.
- Ambiguous numeric dates (e.g. `10/01/2025`) can be read day-first by the AI where the regex fallback assumes US month-first.
- Legacy `.doc` (pre-2007 Word) is rejected — save as `.docx` or export to PDF.
- Statutory references are AI-suggested and must be verified on Singapore Statutes Online / with counsel.
- DOCX files have no fixed page numbers, so their citations use clause/paragraph references instead of page links.
