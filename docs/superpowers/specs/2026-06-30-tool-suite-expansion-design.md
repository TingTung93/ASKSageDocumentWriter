# Tool Suite Expansion Design Spec

## Overview
This specification details the architecture and implementation strategy for expanding the LLM's Tool Suite within the Ask Sage Document Writer. The goal is to provide the LLM with the ability to dynamically render visual data (charts, flowcharts) and to perform targeted extraction against massive attached reference files (PDFs, CSVs) without overloading the context window.

## 1. Advanced Data Visualization

### Core Concept
The LLM will be equipped with tools to define data charts and structural flowcharts. The React SPA will render these definitions into PNG images invisibly on the client-side, and the document assembler will embed those PNGs directly into the exported DOCX layout.

### LLM Tools
* **`generate_data_chart`**:
  * **Parameters**: `type` (e.g., 'bar', 'line', 'pie'), `data` (Array of numbers), `labels` (Array of strings), `title` (String).
  * **Behavior**: Instructs the system to render a statistical chart.
* **`generate_flowchart`**:
  * **Parameters**: `mermaid_code` (String).
  * **Behavior**: Instructs the system to render a diagram using Mermaid.js syntax.

### Client-Side Rendering
* **Dependencies**: We will utilize `chart.js` for data charts and `mermaid` for flowcharts.
* **Process**: 
  1. The Drafter loop intercepts the tool call.
  2. A hidden DOM element or off-screen canvas is used to render the requested chart/diagram.
  3. The rendered output is captured and converted to a base64 encoded PNG data URI.
  4. The tool returns a `reference_id` to the LLM (e.g., `chart_1`), indicating that the chart was successfully generated and stored in memory.

### DOCX Integration (Assembler)
* **LLM Output Schema**: The LLM will use a new paragraph role: `{"role": "image", "reference_id": "chart_1"}`.
* **Assembler (`assemble.ts`) Updates**:
  1. Detect the `image` role.
  2. Retrieve the base64 PNG from the drafter's memory using the `reference_id`.
  3. Inject the PNG into the ZIP archive under `word/media/imageX.png`.
  4. Register the image relationship in `word/_rels/document.xml.rels` and `[Content_Types].xml`.
  5. Emit the necessary OOXML `<w:drawing>` tags to embed the image inline within the paragraph.

## 2. Direct File Extraction

### Core Concept
Users need the ability to provide massive reference documents (100+ page PDFs, large CSVs) to the LLM. Instead of pasting the entire text into the prompt, the user attaches the file in the UI, and the LLM uses specific tools to query only the slices of data it needs at any given moment.

### UI Additions
* Add a "Reference Attachments" dropzone in the drafting interface.
* Files dropped here are parsed into a local in-memory registry, assigned a `file_id`, and pre-processed (e.g., PDF pages are counted, CSV headers are extracted).

### LLM Tools
* **`list_attached_files()`**:
  * **Parameters**: None.
  * **Returns**: Array of file metadata, e.g., `[{ "file_id": "doc1", "type": "pdf", "page_count": 142 }, { "file_id": "data1", "type": "csv", "columns": ["Name", "Score"] }]`.
* **`read_pdf_pages()`**:
  * **Parameters**: `file_id` (String), `start_page` (Number), `end_page` (Number).
  * **Behavior**: Uses `pdf.js` to extract and return the raw text only from the specified page range.
* **`query_csv()`**:
  * **Parameters**: `file_id` (String), `columns` (Array of Strings).
  * **Behavior**: Uses `PapaParse` to extract the CSV data, filtering down to only the requested columns, and returns a JSON-stringified subset.

## Trade-offs & Considerations
* **Client-Side Heavy**: Rendering charts and parsing PDFs in the browser adds computational overhead. We must ensure these operations don't freeze the main thread excessively.
* **Tool Loop Exhaustion**: The LLM might get stuck in a loop trying to guess PDF page numbers. We must provide clear instructions in the system prompt to guide its search behavior.
* **Image Sizing**: The DOCX assembler will need to apply default width/height constraints to the `<w:drawing>` elements to ensure charts don't break the page layout.

## Next Steps
1. Add `chart.js`, `mermaid`, `pdfjs-dist`, and `papaparse` to dependencies.
2. Implement the off-screen rendering engine for Data Visualizations.
3. Update the DOCX assembler to handle image injection.
4. Implement the file attachment UI and the PDF/CSV parsing utilities.
5. Register the new tools in the Drafter ReAct loop.
