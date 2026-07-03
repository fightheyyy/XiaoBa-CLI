---
name: sales-pivot-analysis-bundle
description: Arena materialized SkillsBench skill bundle for sales-pivot-analysis. Use this when completing the sales-pivot-analysis gold case in a clean XiaoBa runtime.
---

# SkillsBench sales-pivot-analysis Bundle

This arena-only skill bundle preserves the task-visible procedural skills from the pinned SkillsBench task package. It intentionally excludes oracle answers and verifier assertions.

Use the workspace files the user mentions. Write final artifacts in the current workspace directory, not in `/root`.

## Original Skill: pdf

---
name: pdf
description: "ALWAYS use this skill instead of the Read tool for PDF files. The Read tool cannot extract PDF tables properly. Use this skill when: (1) Reading ANY PDF file, (2) Extracting tables from PDFs, (3) Converting PDF tables to pandas DataFrames, (4) Processing multi-page PDFs"
---

# PDF Processing Guide

## IMPORTANT: Do NOT Use the Read Tool for PDFs

**The Read tool cannot properly extract tabular data from PDFs.** It will only show you a limited preview of the first page's text content, missing most of the data.

For PDF files, especially multi-page PDFs with tables:
- **DO**: Use `pdfplumber` as shown in this skill
- **DO NOT**: Use the Read tool to view PDF contents

If you need to extract data from a PDF, write Python code using pdfplumber. This is the only reliable way to get complete table data from all pages.

## Overview

Extract text and tables from PDF documents using Python libraries.

## Table Extraction with pdfplumber

pdfplumber is the recommended library for extracting tables from PDFs.

### Basic Table Extraction

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            print(table)  # List of lists
```

### Convert to pandas DataFrame

```python
import pdfplumber
import pandas as pd

with pdfplumber.open("document.pdf") as pdf:
    page = pdf.pages[0]  # First page
    tables = page.extract_tables()

    if tables:
        # First row is usually headers
        table = tables[0]
        df = pd.DataFrame(table[1:], columns=table[0])
        print(df)
```

### Extract All Tables from Multi-Page PDF

```python
import pdfplumber
import pandas as pd

all_tables = []

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            if table and len(table) > 1:  # Has data
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

# Combine if same structure
if all_tables:
    combined = pd.concat(all_tables, ignore_index=True)
```

## Text Extraction

### Full Page Text

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    text = ""
    for page in pdf.pages:
        text += page.extract_text() + "\n"
```

### Text with Layout Preserved

```python
with pdfplumber.open("document.pdf") as pdf:
    page = pdf.pages[0]
    text = page.extract_text(layout=True)
```

## Common Patterns

### Extract Multiple Tables and Create Mappings

When a PDF contains multiple related tables (possibly spanning multiple pages), extract from ALL pages and build lookup dictionaries:

```python
import pdfplumber
import pandas as pd

category_map = {}      # CategoryID -> CategoryName
product_map = {}       # ProductID -> (ProductName, CategoryID)

with pdfplumber.open("catalog.pdf") as pdf:
    for page_num, page in enumerate(pdf.pages):
        tables = page.extract_tables()

        for table in tables:
            if not table or len(table) < 2:
                continue

            # Check first row to identify table type
            header = [str(cell).strip() if cell else '' for cell in table[0]]

            # Determine if first row is header or data (continuation page)
            if 'CategoryID' in header and 'CategoryName' in header:
                # Categories table with header
                for row in table[1:]:
                    if row and len(row) >= 2 and row[0]:
                        cat_id = int(row[0].strip())
                        cat_name = row[1].strip()
                        category_map[cat_id] = cat_name

            elif 'ProductID' in header and 'ProductName' in header:
                # Products table with header
                for row in table[1:]:
                    if row and len(row) >= 3 and row[0]:
                        try:
                            prod_id = int(row[0].strip())
                            prod_name = row[1].strip()
                            cat_id = int(row[2].strip())
                            product_map[prod_id] = (prod_name, cat_id)
                        except (ValueError, AttributeError):
                            continue
            else:
                # Continuation page (no header) - check if it's product data
                for row in table:
                    if row and len(row) >= 3 and row[0]:
                        try:
                            prod_id = int(row[0].strip())
                            prod_name = row[1].strip()
                            cat_id = int(row[2].strip())
                            product_map[prod_id] = (prod_name, cat_id)
                        except (ValueError, AttributeError):
                            continue

# Build final mapping: ProductID -> CategoryName
product_to_category_name = {
    pid: category_map[cat_id]
    for pid, (name, cat_id) in product_map.items()
}
# {1: 'Beverages', 2: 'Beverages', 3: 'Condiments', ...}
```

**Important:** Always iterate over ALL pages (`for page in pdf.pages`) - tables often span multiple pages, and continuation pages may not have headers.

### Clean Extracted Table Data

```python
import pdfplumber
import pandas as pd

with pdfplumber.open("document.pdf") as pdf:
    table = pdf.pages[0].extract_tables()[0]
    df = pd.DataFrame(table[1:], columns=table[0])

    # Clean whitespace
    df = df.apply(lambda x: x.str.strip() if x.dtype == "object" else x)

    # Remove empty rows
    df = df.dropna(how='all')

    # Rename columns if needed
    df.columns = df.columns.str.strip()
```

### Handle Missing Headers

```python
# If table has no header row
table = pdf.pages[0].extract_tables()[0]
df = pd.DataFrame(table)
df.columns = ['Col1', 'Col2', 'Col3', 'Col4']  # Assign manually
```

## Quick Reference

| Task | Code |
|------|------|
| Open PDF | `pdfplumber.open("file.pdf")` |
| Get pages | `pdf.pages` |
| Extract tables | `page.extract_tables()` |
| Extract text | `page.extract_text()` |
| Table to DataFrame | `pd.DataFrame(table[1:], columns=table[0])` |

## Troubleshooting

- **Empty table**: Try `page.extract_tables(table_settings={...})` with custom settings
- **Merged cells**: Tables with merged cells may extract incorrectly
- **Scanned PDFs**: Use OCR (pytesseract) for image-based PDFs
- **No tables found**: Check if content is actually a table or styled text


## Original Skill: xlsx

---
name: xlsx
description: "Comprehensive spreadsheet creation, editing, and analysis with support for formulas, formatting, data analysis, and pivot tables. When Claude needs to work with spreadsheets (.xlsx files) for: (1) Creating new spreadsheets with data and formatting, (2) Reading or analyzing Excel data with pandas, (3) Creating pivot tables programmatically with openpyxl, (4) Building multi-sheet workbooks with source data and pivot table sheets, or (5) Any Excel file operations"
---

# XLSX Creation, Editing, and Analysis

## Overview

This skill covers working with Excel files using Python libraries: **openpyxl** for Excel-specific features (formatting, formulas, pivot tables) and **pandas** for data analysis.

## Reading Data

### With pandas (recommended for analysis)
```python
import pandas as pd

df = pd.read_excel('file.xlsx')  # First sheet
all_sheets = pd.read_excel('file.xlsx', sheet_name=None)  # All sheets as dict
df.head()      # Preview
df.describe()  # Statistics
```

### With openpyxl (for cell-level access)
```python
from openpyxl import load_workbook

wb = load_workbook('file.xlsx')
ws = wb.active
value = ws['A1'].value

# Read calculated values (not formulas)
wb = load_workbook('file.xlsx', data_only=True)
```

## Creating Excel Files

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

wb = Workbook()
ws = wb.active
ws.title = "Data"

# Add data
ws['A1'] = 'Header'
ws.append(['Row', 'of', 'data'])

# Formatting
ws['A1'].font = Font(bold=True)
ws['A1'].fill = PatternFill('solid', start_color='2c3e50')

wb.save('output.xlsx')
```

## Creating Pivot Tables

Pivot tables summarize data by grouping and aggregating. Use openpyxl's pivot table API.

**CRITICAL: All pivot tables MUST use `cacheId=0`**. Using any other cacheId (1, 2, etc.) will cause openpyxl to fail when reading the file back with `KeyError`. This is an openpyxl limitation.

### Basic Pivot Table Structure

```python
from openpyxl import Workbook
from openpyxl.pivot.table import TableDefinition, Location, PivotField, DataField, RowColField
from openpyxl.pivot.cache import CacheDefinition, CacheField, CacheSource, WorksheetSource, SharedItems

# 1. Create workbook with source data
wb = Workbook()
data_ws = wb.active
data_ws.title = "SourceData"

# Write your data (with headers in row 1)
data = [
    ["CategoryName", "ProductName", "Quantity", "Revenue"],
    ["Beverages", "Chai", 25, 450.00],
    ["Seafood", "Ikura", 12, 372.00],
    # ... more rows
]
for row in data:
    data_ws.append(row)

num_rows = len(data)

# 2. Create pivot table sheet
pivot_ws = wb.create_sheet("PivotAnalysis")

# 3. Define the cache (source data reference)
cache = CacheDefinition(
    cacheSource=CacheSource(
        type="worksheet",
        worksheetSource=WorksheetSource(
            ref=f"A1:D{num_rows}",  # Adjust to your data range
            sheet="SourceData"
        )
    ),
    cacheFields=[
        CacheField(name="CategoryName", sharedItems=SharedItems(count=8)),
        CacheField(name="ProductName", sharedItems=SharedItems(count=40)),
        CacheField(name="Quantity", sharedItems=SharedItems()),
        CacheField(name="Revenue", sharedItems=SharedItems()),
    ]
)

# 4. Create pivot table definition
pivot = TableDefinition(
    name="RevenueByCategory",
    cacheId=0,  # MUST be 0 for ALL pivot tables - any other value breaks openpyxl
    dataCaption="Values",
    location=Location(
        ref="A3:B10",  # Where pivot table will appear
        firstHeaderRow=1,
        firstDataRow=1,
        firstDataCol=1
    ),
)

# 5. Configure pivot fields (one for each source column)
# Fields are indexed 0, 1, 2, 3 matching cache field order

# Field 0: CategoryName - use as ROW
pivot.pivotFields.append(PivotField(axis="axisRow", showAll=False))
# Field 1: ProductName - not used (just include it)
pivot.pivotFields.append(PivotField(showAll=False))
# Field 2: Quantity - not used
pivot.pivotFields.append(PivotField(showAll=False))
# Field 3: Revenue - use as DATA (for aggregation)
pivot.pivotFields.append(PivotField(dataField=True, showAll=False))

# 6. Add row field reference (index of the field to use as rows)
pivot.rowFields.append(RowColField(x=0))  # CategoryName is field 0

# 7. Add data field with aggregation
pivot.dataFields.append(DataField(
    name="Total Revenue",
    fld=3,  # Revenue is field index 3
    subtotal="sum"  # Options: sum, count, average, max, min, product, stdDev, var
))

# 8. Attach cache and add to worksheet
pivot.cache = cache
pivot_ws._pivots.append(pivot)

wb.save('output_with_pivot.xlsx')
```

### Common Pivot Table Configurations

#### Count by Category (Order Count)
```python
# Row field: CategoryName (index 0)
# Data field: Count any column

pivot.rowFields.append(RowColField(x=0))  # CategoryName as rows
pivot.dataFields.append(DataField(
    name="Order Count",
    fld=1,  # Any field works for count
    subtotal="count"
))
```

#### Sum by Category (Total Revenue)
```python
pivot.rowFields.append(RowColField(x=0))  # CategoryName as rows
pivot.dataFields.append(DataField(
    name="Total Revenue",
    fld=3,  # Revenue field
    subtotal="sum"
))
```

#### Two-Dimensional Pivot (Rows and Columns)
```python
# CategoryName as rows, Quarter as columns, revenue as values
pivot.pivotFields[0] = PivotField(axis="axisRow", showAll=False)  # Category = row
pivot.pivotFields[1] = PivotField(axis="axisCol", showAll=False)  # Quarter = col
pivot.pivotFields[3] = PivotField(dataField=True, showAll=False)  # Revenue = data

pivot.rowFields.append(RowColField(x=0))  # Category
pivot.colFields.append(RowColField(x=1))  # Quarter
pivot.dataFields.append(DataField(name="Revenue", fld=3, subtotal="sum"))
```

#### Multiple Data Fields
```python
# Show both count and sum
pivot.dataFields.append(DataField(name="Order Count", fld=2, subtotal="count"))
pivot.dataFields.append(DataField(name="Total Revenue", fld=3, subtotal="sum"))
```

### Pivot Table Field Configuration Reference

| axis value | Meaning |
|------------|---------|
| `"axisRow"` | Field appears as row labels |
| `"axisCol"` | Field appears as column labels |
| `"axisPage"` | Field is a filter/slicer |
| (none) | Field not used for grouping |

| subtotal value | Aggregation |
|----------------|-------------|
| `"sum"` | Sum of values |
| `"count"` | Count of items |
| `"average"` | Average/mean |
| `"max"` | Maximum value |
| `"min"` | Minimum value |
| `"product"` | Product of values |
| `"stdDev"` | Standard deviation |
| `"var"` | Variance |

### Important Notes

1. **CRITICAL - cacheId must be 0**: ALL pivot tables must use `cacheId=0`. Using 1, 2, etc. will cause `KeyError` when reading the file
2. **Field indices must match**: The order of `cacheFields` must match your source data columns
3. **Location ref**: The `ref` in Location is approximate - Excel will adjust when opened
4. **Cache field count**: For categorical fields, set `count` parameter to approximate number of unique values
5. **Multiple pivots**: Each pivot table needs its own sheet for clarity
6. **Values populate on open**: Pivot table values are calculated when the file is opened in Excel/LibreOffice, not when created

## Working with Existing Excel Files

```python
from openpyxl import load_workbook

wb = load_workbook('existing.xlsx')
ws = wb['SheetName']

# Modify
ws['A1'] = 'New Value'
ws.insert_rows(2)

# Add new sheet
new_ws = wb.create_sheet('Analysis')

wb.save('modified.xlsx')
```

## Best Practices

1. **Use pandas for data manipulation**, openpyxl for Excel features
2. **Match field indices carefully** when creating pivot tables
3. **Test with small data first** before scaling up
4. **Name your sheets clearly** (e.g., "SourceData", "RevenueByCategory")
5. **Document your pivot table structure** with comments in code
