# Document Research References Design

## Purpose

Bring the Ask Sage research-pack workflow into the Documents tab so document cleanup and targeted edits can be supported by fresh cited references.

## Scope

The feature is Ask Sage-only and uses the existing live web search research runner. It does not change the document edit engine. Instead, it generates a cited Markdown research pack and stores it as a document reference file, which the existing cleanup flow already inlines into every edit prompt.

## User Flow

Inside the existing cleanup context panel, add a "Research for this edit" section. The user can enter a research objective, optional focus questions, and depth. The objective defaults to the current cleanup instruction so users can quickly research support for the edit they are about to request.

When run, the app calls Ask Sage live search, saves the returned research pack on the document, and attaches its Markdown as an already-extracted reference file. The reference appears in the existing reference-file list and is included automatically when the user requests cleanup edits.

## Data Model

Add optional `DocumentRecord.research_packs?: ResearchPack[]`. Store generated Markdown in `DocumentRecord.reference_files` as a `ProjectContextFile` with `extracted_text` set, so the edit pass can reuse it without another file upload.

## Testing

Add tests for document research persistence and lightweight document research helpers. Existing research runner tests cover the Ask Sage request shape; existing document edit behavior covers reference inlining and `references_used`.
