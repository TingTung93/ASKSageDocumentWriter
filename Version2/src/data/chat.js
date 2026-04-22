// Demo data for the Co-Writer prototype. Placeholder content only — no proprietary info.

window.CHAT = [
  {
    id: "m1", role: "user", name: "LT Nguyen, Tricia",
    time: "10:14",
    body: [
      "Draft a PWS for Embedded Behavioral Health services at Walter Reed. ~18 FTEs: LCSWs, clinical psychologists, and a psychiatric NP. Emphasize active duty warfighter readiness and integration with MHS GENESIS."
    ],
  },
  {
    id: "m2", role: "ai", name: "Co-Writer",
    time: "10:14",
    body: [
      "Got it. I'll base the structure on the FY24 EBH SOW you attached and pull clinical requirements from DHA-PI 6490.01. Before I draft:",
    ],
    tool: {
      title: "read 4 sources",
      rows: [
        { ok: true, text: "FY24 Embedded Behavioral Health SOW", n: "14 pp" },
        { ok: true, text: "DHA-PI 6490.01 — Behavioral Health Service Delivery", n: "32 pp" },
        { ok: true, text: "MHS GENESIS Integration Requirements v3.2", n: "48 pp" },
        { ok: true, text: "Camp Pendleton EBH — historical performance notes", n: "6 pp" },
      ],
    },
    followup: "Three things I'd like to confirm — I can fill in placeholders if you'd rather I just draft first:",
    questions: [
      "Period of performance — I'm assuming 1 base + 4 options, 12-month each",
      "Clearance — Tier 3 (Secret) for all clinicians, or just the lead?",
      "Is 18 FTEs firm, or should I use a staffing ratio tied to beneficiary population?",
    ],
    applyable: true,
  },
  {
    id: "m3", role: "user", name: "LT Nguyen, Tricia",
    time: "10:16",
    body: [
      "Draft first. POP is 1+4 x 12-month. Tier 3 for all. Use the ratio — 1 FTE per 750 covered beneficiaries, round up."
    ],
  },
  {
    id: "m4", role: "ai", name: "Co-Writer",
    time: "10:16",
    status: "drafting",
    body: [
      "On it. Drafting section-by-section with your reference SOW as the skeleton and DHA-PI 6490.01 for clinical requirements. I'll flag anything the sources don't cover.",
    ],
    progress: {
      done: ["1.1 Background", "1.2 Scope of Services"],
      active: "1.3 Performance Objectives",
      queued: 5,
    },
  },
];
