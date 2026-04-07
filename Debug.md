Simple memo template

{
  "$schema": "https://asksage-doc-writer.local/schemas/template/v2",
  "id": "bc768ece-5dff-4ec8-b610-27726ed01284",
  "name": "Mission Essential Memo",
  "version": 1,
  "source": {
    "filename": "Mission Essential Memo.docx",
    "ingested_at": "2026-04-07T22:52:24.879Z",
    "structural_parser_version": "0.1.0",
    "semantic_synthesizer": "google-gemini-2.5-flash",
    "docx_blob_id": "docx://0f6304ef-3f8a-42f5-a363-f6ea1c3ac2d1"
  },
  "formatting": {
    "page_setup": {
      "paper": "letter",
      "orientation": "portrait",
      "margins_twips": {
        "top": 1440,
        "right": 1440,
        "bottom": 1440,
        "left": 1440
      },
      "header_distance": 720,
      "footer_distance": 720
    },
    "default_font": {
      "family": "Times New Roman",
      "size_pt": null
    },
    "theme": null,
    "named_styles": [
      {
        "id": "Normal",
        "name": "Normal",
        "type": "paragraph",
        "based_on": null,
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "Heading1",
        "name": "heading 1",
        "type": "paragraph",
        "based_on": "Normal",
        "outline_level": 0,
        "numbering_id": null
      },
      {
        "id": "Heading2",
        "name": "heading 2",
        "type": "paragraph",
        "based_on": "Normal",
        "outline_level": 1,
        "numbering_id": null
      },
      {
        "id": "DefaultParagraphFont",
        "name": "Default Paragraph Font",
        "type": "character",
        "based_on": null,
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "TableNormal",
        "name": "Normal Table",
        "type": "table",
        "based_on": null,
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "NoList",
        "name": "No List",
        "type": "numbering",
        "based_on": null,
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "Title",
        "name": "Title",
        "type": "paragraph",
        "based_on": "Normal",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "Subtitle",
        "name": "Subtitle",
        "type": "paragraph",
        "based_on": "Normal",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "BodyText",
        "name": "Body Text",
        "type": "paragraph",
        "based_on": "Normal",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "Header",
        "name": "header",
        "type": "paragraph",
        "based_on": "Normal",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "CompanyName",
        "name": "Company Name",
        "type": "paragraph",
        "based_on": "Subtitle",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "Footer",
        "name": "footer",
        "type": "paragraph",
        "based_on": "Normal",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "LHDA",
        "name": "LHDA",
        "type": "paragraph",
        "based_on": "Title",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "BalloonText",
        "name": "Balloon Text",
        "type": "paragraph",
        "based_on": "Normal",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "BlackDODSeal",
        "name": "BlackDODSeal",
        "type": "paragraph",
        "based_on": null,
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "PageNumber",
        "name": "page number",
        "type": "character",
        "based_on": "DefaultParagraphFont",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "BodyTextIndent",
        "name": "Body Text Indent",
        "type": "paragraph",
        "based_on": "Normal",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "Hyperlink",
        "name": "Hyperlink",
        "type": "character",
        "based_on": "DefaultParagraphFont",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "FollowedHyperlink",
        "name": "FollowedHyperlink",
        "type": "character",
        "based_on": "DefaultParagraphFont",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "PlainText",
        "name": "Plain Text",
        "type": "paragraph",
        "based_on": "Normal",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "PlainTextChar",
        "name": "Plain Text Char",
        "type": "character",
        "based_on": "DefaultParagraphFont",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "ListParagraph",
        "name": "List Paragraph",
        "type": "paragraph",
        "based_on": "Normal",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "TableGrid",
        "name": "Table Grid",
        "type": "table",
        "based_on": "TableNormal",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "HeaderChar",
        "name": "Header Char",
        "type": "character",
        "based_on": "DefaultParagraphFont",
        "outline_level": null,
        "numbering_id": null
      },
      {
        "id": "UnresolvedMention",
        "name": "Unresolved Mention",
        "type": "character",
        "based_on": "DefaultParagraphFont",
        "outline_level": null,
        "numbering_id": null
      }
    ],
    "numbering_definitions": [
      {
        "id": 1,
        "abstract_id": 21,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 0
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 0
          },
          {
            "level": 2,
            "format": "none",
            "text": "%3",
            "indent_twips": 0
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 2,
        "abstract_id": 6,
        "levels": [
          {
            "level": 0,
            "format": "lowerLetter",
            "text": "%1.",
            "indent_twips": 0
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 3,
        "abstract_id": 2,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 0
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 0
          },
          {
            "level": 2,
            "format": "none",
            "text": "",
            "indent_twips": 0
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 4,
        "abstract_id": 15,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 0
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 0
          },
          {
            "level": 2,
            "format": "none",
            "text": "%3",
            "indent_twips": 0
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 5,
        "abstract_id": 31,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "(%1)",
            "indent_twips": 1155
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1800
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2520
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 3240
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3960
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4680
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5400
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 6120
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6840
          }
        ]
      },
      {
        "id": 6,
        "abstract_id": 4,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "(%1)",
            "indent_twips": 2044
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 2764
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 3484
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 4204
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 4924
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 5644
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 6364
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 7084
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 7804
          }
        ]
      },
      {
        "id": 7,
        "abstract_id": 7,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "(%1)",
            "indent_twips": 1200
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "(%2)",
            "indent_twips": 1860
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2520
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 3240
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3960
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4680
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5400
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 6120
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6840
          }
        ]
      },
      {
        "id": 8,
        "abstract_id": 19,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "(%1)",
            "indent_twips": 1230
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1800
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2520
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 3240
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3960
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4680
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5400
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 6120
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6840
          }
        ]
      },
      {
        "id": 9,
        "abstract_id": 10,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 10,
        "abstract_id": 30,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 360
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 720
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 1440
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2160
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 2880
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 3600
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 4320
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5040
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 5760
          }
        ]
      },
      {
        "id": 11,
        "abstract_id": 8,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 12,
        "abstract_id": 13,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 13,
        "abstract_id": 28,
        "levels": [
          {
            "level": 0,
            "format": "lowerLetter",
            "text": "(%1)",
            "indent_twips": 1080
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1800
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2520
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 3240
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3960
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4680
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5400
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 6120
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6840
          }
        ]
      },
      {
        "id": 14,
        "abstract_id": 16,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 15,
        "abstract_id": 24,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 16,
        "abstract_id": 14,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 17,
        "abstract_id": 29,
        "levels": [
          {
            "level": 0,
            "format": "lowerLetter",
            "text": "%1)",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 18,
        "abstract_id": 20,
        "levels": [
          {
            "level": 0,
            "format": "lowerLetter",
            "text": "%1.",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 19,
        "abstract_id": 25,
        "levels": [
          {
            "level": 0,
            "format": "lowerLetter",
            "text": "%1)",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 20,
        "abstract_id": 12,
        "levels": [
          {
            "level": 0,
            "format": "lowerLetter",
            "text": "%1)",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 21,
        "abstract_id": 9,
        "levels": [
          {
            "level": 0,
            "format": "lowerLetter",
            "text": "%1.",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 22,
        "abstract_id": 27,
        "levels": [
          {
            "level": 0,
            "format": "lowerLetter",
            "text": "%1.",
            "indent_twips": 720
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 23,
        "abstract_id": 5,
        "levels": [
          {
            "level": 0,
            "format": "lowerLetter",
            "text": "%1.",
            "indent_twips": 1005
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1440
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 2160
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2880
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3600
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 4320
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 5040
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5760
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6480
          }
        ]
      },
      {
        "id": 24,
        "abstract_id": 26,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 360
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1080
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 1800
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2520
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3240
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 3960
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 4680
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5400
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6120
          }
        ]
      },
      {
        "id": 25,
        "abstract_id": 3,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.  ",
            "indent_twips": 0
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.  ",
            "indent_twips": 0
          },
          {
            "level": 2,
            "format": "decimal",
            "text": "(%3)  ",
            "indent_twips": 0
          },
          {
            "level": 3,
            "format": "lowerLetter",
            "text": "(%4)  ",
            "indent_twips": 0
          },
          {
            "level": 4,
            "format": "none",
            "text": "",
            "indent_twips": 1800
          },
          {
            "level": 5,
            "format": "none",
            "text": "",
            "indent_twips": 2160
          },
          {
            "level": 6,
            "format": "none",
            "text": "",
            "indent_twips": 2520
          },
          {
            "level": 7,
            "format": "none",
            "text": "",
            "indent_twips": 2880
          },
          {
            "level": 8,
            "format": "none",
            "text": "",
            "indent_twips": 3240
          }
        ]
      },
      {
        "id": 26,
        "abstract_id": 32,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1)",
            "indent_twips": 360
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2)",
            "indent_twips": 720
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3)",
            "indent_twips": 1080
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "(%4)",
            "indent_twips": 1440
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "(%5)",
            "indent_twips": 1800
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "(%6)",
            "indent_twips": 2160
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 2520
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 2880
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 3240
          }
        ]
      },
      {
        "id": 27,
        "abstract_id": 22,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.  ",
            "indent_twips": 0
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.  ",
            "indent_twips": 0
          },
          {
            "level": 2,
            "format": "decimal",
            "text": "(%3)  ",
            "indent_twips": 0
          },
          {
            "level": 3,
            "format": "lowerLetter",
            "text": "(%4)  ",
            "indent_twips": 0
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "(%5)",
            "indent_twips": 1800
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "(%6)",
            "indent_twips": 2160
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 2520
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 2880
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 3240
          }
        ]
      },
      {
        "id": 28,
        "abstract_id": 18,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 1440
          },
          {
            "level": 1,
            "format": "bullet",
            "text": "o",
            "indent_twips": 2160
          },
          {
            "level": 2,
            "format": "bullet",
            "text": "",
            "indent_twips": 2880
          },
          {
            "level": 3,
            "format": "bullet",
            "text": "",
            "indent_twips": 3600
          },
          {
            "level": 4,
            "format": "bullet",
            "text": "o",
            "indent_twips": 4320
          },
          {
            "level": 5,
            "format": "bullet",
            "text": "",
            "indent_twips": 5040
          },
          {
            "level": 6,
            "format": "bullet",
            "text": "",
            "indent_twips": 5760
          },
          {
            "level": 7,
            "format": "bullet",
            "text": "o",
            "indent_twips": 6480
          },
          {
            "level": 8,
            "format": "bullet",
            "text": "",
            "indent_twips": 7200
          }
        ]
      },
      {
        "id": 29,
        "abstract_id": 17,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1. ",
            "indent_twips": 0
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2. ",
            "indent_twips": 0
          },
          {
            "level": 2,
            "format": "decimal",
            "text": "(%3) ",
            "indent_twips": 0
          },
          {
            "level": 3,
            "format": "lowerLetter",
            "text": "(%4)  ",
            "indent_twips": 0
          },
          {
            "level": 4,
            "format": "none",
            "text": "",
            "indent_twips": 1800
          },
          {
            "level": 5,
            "format": "none",
            "text": "",
            "indent_twips": 2160
          },
          {
            "level": 6,
            "format": "none",
            "text": "",
            "indent_twips": 2520
          },
          {
            "level": 7,
            "format": "none",
            "text": "",
            "indent_twips": 2880
          },
          {
            "level": 8,
            "format": "none",
            "text": "",
            "indent_twips": 3240
          }
        ]
      },
      {
        "id": 30,
        "abstract_id": 23,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.  ",
            "indent_twips": 0
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.  ",
            "indent_twips": 0
          },
          {
            "level": 2,
            "format": "decimal",
            "text": "(%3)  ",
            "indent_twips": 0
          },
          {
            "level": 3,
            "format": "lowerLetter",
            "text": "(%4)  ",
            "indent_twips": 0
          },
          {
            "level": 4,
            "format": "none",
            "text": "",
            "indent_twips": 1800
          },
          {
            "level": 5,
            "format": "none",
            "text": "",
            "indent_twips": 2160
          },
          {
            "level": 6,
            "format": "none",
            "text": "",
            "indent_twips": 2520
          },
          {
            "level": 7,
            "format": "none",
            "text": "",
            "indent_twips": 2880
          },
          {
            "level": 8,
            "format": "none",
            "text": "",
            "indent_twips": 3240
          }
        ]
      },
      {
        "id": 31,
        "abstract_id": 1,
        "levels": [
          {
            "level": 0,
            "format": "lowerLetter",
            "text": "%1.",
            "indent_twips": 1530
          },
          {
            "level": 1,
            "format": "bullet",
            "text": "•",
            "indent_twips": 2414
          },
          {
            "level": 2,
            "format": "bullet",
            "text": "•",
            "indent_twips": 3289
          },
          {
            "level": 3,
            "format": "bullet",
            "text": "•",
            "indent_twips": 4164
          },
          {
            "level": 4,
            "format": "bullet",
            "text": "•",
            "indent_twips": 5039
          },
          {
            "level": 5,
            "format": "bullet",
            "text": "•",
            "indent_twips": 5914
          },
          {
            "level": 6,
            "format": "bullet",
            "text": "•",
            "indent_twips": 6789
          },
          {
            "level": 7,
            "format": "bullet",
            "text": "•",
            "indent_twips": 7664
          },
          {
            "level": 8,
            "format": "bullet",
            "text": "•",
            "indent_twips": 8539
          }
        ]
      },
      {
        "id": 32,
        "abstract_id": 0,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 1076
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 4041
          },
          {
            "level": 2,
            "format": "decimal",
            "text": "(%3)",
            "indent_twips": 783
          },
          {
            "level": 3,
            "format": "bullet",
            "text": "•",
            "indent_twips": 840
          },
          {
            "level": 4,
            "format": "bullet",
            "text": "•",
            "indent_twips": 880
          },
          {
            "level": 5,
            "format": "bullet",
            "text": "•",
            "indent_twips": 920
          },
          {
            "level": 6,
            "format": "bullet",
            "text": "•",
            "indent_twips": 1080
          },
          {
            "level": 7,
            "format": "bullet",
            "text": "•",
            "indent_twips": 1440
          },
          {
            "level": 8,
            "format": "bullet",
            "text": "•",
            "indent_twips": 1500
          }
        ]
      },
      {
        "id": 33,
        "abstract_id": 11,
        "levels": [
          {
            "level": 0,
            "format": "decimal",
            "text": "%1.",
            "indent_twips": 360
          },
          {
            "level": 1,
            "format": "lowerLetter",
            "text": "%2.",
            "indent_twips": 1080
          },
          {
            "level": 2,
            "format": "lowerRoman",
            "text": "%3.",
            "indent_twips": 1800
          },
          {
            "level": 3,
            "format": "decimal",
            "text": "%4.",
            "indent_twips": 2520
          },
          {
            "level": 4,
            "format": "lowerLetter",
            "text": "%5.",
            "indent_twips": 3240
          },
          {
            "level": 5,
            "format": "lowerRoman",
            "text": "%6.",
            "indent_twips": 3960
          },
          {
            "level": 6,
            "format": "decimal",
            "text": "%7.",
            "indent_twips": 4680
          },
          {
            "level": 7,
            "format": "lowerLetter",
            "text": "%8.",
            "indent_twips": 5400
          },
          {
            "level": 8,
            "format": "lowerRoman",
            "text": "%9.",
            "indent_twips": 6120
          }
        ]
      }
    ],
    "headers": [
      {
        "type": "default",
        "part": "word/header1.xml"
      },
      {
        "type": "default",
        "part": "word/header2.xml"
      }
    ],
    "footers": [
      {
        "type": "default",
        "part": "word/footer1.xml"
      },
      {
        "type": "default",
        "part": "word/footer2.xml"
      }
    ]
  },
  "metadata_fill_regions": [],
  "sections": [],
  "style": {
    "voice": "third_person",
    "tense": "present",
    "register": "formal_government",
    "jargon_policy": "Use precise, official military and government terminology and acronyms.",
    "banned_phrases": [
      "synergy",
      "leverage",
      "paradigm shift",
      "value-add",
      "going forward",
      "best in class",
      "think outside the box",
      "low-hanging fruit",
      "circle back",
      "win-win",
      "robust solution"
    ]
  }
}
