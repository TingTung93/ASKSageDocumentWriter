// Demo data for the Co-Writer prototype. Placeholder content only — no proprietary info.

window.SOURCES = {
  attached: [
    { id: "s1", kind: "docx", kindLabel: "docx", title: "FY24 Embedded Behavioral Health SOW (reference)", meta: "14 pages · 8,420 tokens", cites: [1, 3] },
    { id: "s2", kind: "pdf",  kindLabel: "pdf",  title: "DHA-PI 6490.01 — Behavioral Health Service Delivery", meta: "Policy · 32 pages", cites: [2] },
    { id: "s3", kind: "pdf",  kindLabel: "pdf",  title: "MHS GENESIS Integration Requirements v3.2", meta: "Technical · 48 pages", cites: [4, 5] },
    { id: "s4", kind: "docx", kindLabel: "docx", title: "Camp Pendleton EBH — historical performance notes", meta: "Internal · 6 pages", cites: [6] },
  ],
  rag: [
    { id: "r1", kind: "rag", kindLabel: "dataset", title: "DHA Contracting Library — 2,140 docs", meta: "Ask Sage · last synced 04/18", cites: [] },
    { id: "r2", kind: "rag", kindLabel: "dataset", title: "Behavioral Health Clinical Guidance",       meta: "Ask Sage · last synced 04/09", cites: [] },
    { id: "r3", kind: "web", kindLabel: "web",     title: "FAR Part 37 — Service Contracting",         meta: "acquisition.gov · pinned",   cites: [7] },
  ],
};

// Sections of the draft. Each has streaming/done/queued status.
