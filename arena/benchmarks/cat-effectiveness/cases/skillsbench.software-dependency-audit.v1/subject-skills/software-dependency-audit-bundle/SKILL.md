---
name: software-dependency-audit-bundle
description: Arena materialized SkillsBench skill bundle for software-dependency-audit. Use this when completing the software-dependency-audit gold case in a clean XiaoBa runtime.
---

# SkillsBench software-dependency-audit Bundle

This arena-only skill bundle preserves the task-visible procedural skills from the pinned SkillsBench task package. It intentionally excludes oracle answers and verifier assertions.

Use the workspace files the user mentions. Write final artifacts in the current workspace directory, not in `/root`.

## Original Skill: cvss-score-extraction

---
name: cvss-score-extraction
description: Extract CVSS (Common Vulnerability Scoring System) scores from vulnerability data sources with proper fallback handling. This skill covers understanding CVSS v3, handling multiple score sources (NVD, GHSA, RedHat), implementing source priority logic, and dealing with missing scores in security reporting.
---

# CVSS Score Extraction from Vulnerability Data

This skill provides guidance on extracting CVSS scores from vulnerability data—a critical component of security report generation.

## Overview

CVSS (Common Vulnerability Scoring System) provides a standardized way to assess the severity of security vulnerabilities. When generating security reports, extracting the correct CVSS score from multiple data sources is essential for accurate risk assessment.

## What is CVSS?

### CVSS Scoring System

CVSS assigns a numerical score (0.0-10.0) representing vulnerability severity:

| Score Range | Severity Level | Description |
|-------------|----------------|-------------|
| 0.0 | None | No impact |
| 0.1-3.9 | **Low** | Minimal impact |
| 4.0-6.9 | **Medium** | Moderate impact |
| 7.0-8.9 | **High** | Significant impact |
| 9.0-10.0 | **Critical** | Severe impact |

### CVSS Versions

- **CVSS v2**: Legacy scoring system (0-10 scale)
- **CVSS v3**: Current standard with refined metrics
- **CVSS v3.1**: Minor refinement of v3

**Best Practice**: Prefer CVSS v3/v3.1 scores when available.

## Multiple Vulnerability Data Sources

Vulnerability scanners often aggregate data from multiple sources, each providing their own CVSS assessment:

### Common Sources

1. **NVD (National Vulnerability Database)**
   - Maintained by NIST (U.S. government)
   - Most authoritative source
   - **Priority: Highest**

2. **GHSA (GitHub Security Advisory)**
   - Community-driven vulnerability database
   - Strong for open-source packages
   - **Priority: Medium**

3. **RedHat Security Data**
   - RedHat's security team assessments
   - Focused on enterprise Linux ecosystem
   - **Priority: Lower**

### Why Multiple Sources?

- Not all sources have scores for every CVE
- Scores may differ based on interpretation
- Need fallback logic when primary source unavailable

## Source Priority Strategy

When multiple sources provide scores, use a **priority cascade**:

```
NVD → GHSA → RedHat → N/A
```

**Rationale**: NVD is the most comprehensive and authoritative, followed by community sources, then vendor-specific databases.

## Data Structure

Trivy (and similar tools) return CVSS data in nested format:

```json
{
  "VulnerabilityID": "CVE-2021-44906",
  "PkgName": "minimist",
  "Severity": "CRITICAL",
  "CVSS": {
    "nvd": {
      "V2Vector": "AV:N/AC:L/Au:N/C:P/I:P/A:P",
      "V3Vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      "V2Score": 7.5,
      "V3Score": 9.8
    },
    "ghsa": {
      "V3Vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      "V3Score": 9.8
    }
  }
}
```

## Python Implementation

### Basic Score Extraction

```python
def get_cvss_score(vuln_data):
    """
    Extract CVSS v3 score from vulnerability data.
    Uses priority: NVD > GHSA > RedHat

    Args:
        vuln_data: Dictionary containing vulnerability information

    Returns:
        CVSS v3 score as float, or 'N/A' if not available
    """
    cvss = vuln_data.get('CVSS', {})

    # Priority 1: NVD (National Vulnerability Database)
    if 'nvd' in cvss:
        score = cvss['nvd'].get('V3Score')
        if score is not None:
            return score

    # Priority 2: GHSA (GitHub Security Advisory)
    if 'ghsa' in cvss:
        score = cvss['ghsa'].get('V3Score')
        if score is not None:
            return score

    # Priority 3: RedHat
    if 'redhat' in cvss:
        score = cvss['redhat'].get('V3Score')
        if score is not None:
            return score

    # No score available
    return 'N/A'
```

### Enhanced Version with V2 Fallback

```python
def get_cvss_score_with_fallback(vuln_data):
    """
    Extract CVSS score with v2 fallback.
    Priority: NVD v3 > GHSA v3 > RedHat v3 > NVD v2 > N/A
    """
    cvss = vuln_data.get('CVSS', {})

    # Try v3 scores first
    for source in ['nvd', 'ghsa', 'redhat']:
        if source in cvss:
            v3_score = cvss[source].get('V3Score')
            if v3_score is not None:
                return {'score': v3_score, 'version': 'v3', 'source': source}

    # Fallback to v2 if v3 not available
    if 'nvd' in cvss:
        v2_score = cvss['nvd'].get('V2Score')
        if v2_score is not None:
            return {'score': v2_score, 'version': 'v2', 'source': 'nvd'}

    return {'score': 'N/A', 'version': None, 'source': None}
```

## Usage in Report Generation

### Integrating CVSS Extraction

```python
import json

def parse_vulnerabilities(json_file):
    """Parse Trivy JSON and extract vulnerabilities with CVSS scores."""
    with open(json_file, 'r') as f:
        data = json.load(f)

    vulnerabilities = []

    if 'Results' in data:
        for result in data['Results']:
            for vuln in result.get('Vulnerabilities', []):
                # Extract basic fields
                record = {
                    'Package': vuln.get('PkgName'),
                    'Version': vuln.get('InstalledVersion'),
                    'CVE_ID': vuln.get('VulnerabilityID'),
                    'Severity': vuln.get('Severity'),
                    'CVSS_Score': get_cvss_score(vuln),  # Use extraction function
                    'Fixed_Version': vuln.get('FixedVersion', 'N/A'),
                    'Title': vuln.get('Title', 'No description')
                }
                vulnerabilities.append(record)

    return vulnerabilities
```

## Common Patterns

### Pattern 1: Numeric Score or 'N/A'

```python
cvss_score = get_cvss_score(vuln)
# Returns: 9.8 or 'N/A'
```

**Use case**: Simple reports where missing scores are acceptable

### Pattern 2: Score with Metadata

```python
cvss_info = get_cvss_score_with_fallback(vuln)
# Returns: {'score': 9.8, 'version': 'v3', 'source': 'nvd'}
```

**Use case**: Detailed reports showing data provenance

### Pattern 3: Filtering by Score Threshold

```python
def is_high_severity(vuln_data, threshold=7.0):
    """Check if vulnerability meets severity threshold."""
    score = get_cvss_score(vuln_data)
    if score == 'N/A':
        # If no score, use severity label
        return vuln_data.get('Severity') in ['HIGH', 'CRITICAL']
    return score >= threshold
```

## Error Handling

### Handling Missing Data

```python
def safe_get_cvss_score(vuln_data):
    """Safely extract CVSS score with comprehensive error handling."""
    try:
        cvss = vuln_data.get('CVSS', {})

        # Validate cvss is a dictionary
        if not isinstance(cvss, dict):
            return 'N/A'

        for source in ['nvd', 'ghsa', 'redhat']:
            if source in cvss and isinstance(cvss[source], dict):
                score = cvss[source].get('V3Score')
                # Validate score is numeric
                if score is not None and isinstance(score, (int, float)):
                    return score

        return 'N/A'
    except (AttributeError, TypeError):
        return 'N/A'
```

## Best Practices

1. **Always provide fallback**: Use 'N/A' when scores unavailable
2. **Prefer newer versions**: V3 > V2
3. **Respect source hierarchy**: NVD is most authoritative
4. **Validate data types**: Ensure scores are numeric before using
5. **Document source**: In detailed reports, note which source provided the score

## Complete Example

```python
import json

def get_cvss_score(vuln_data):
    """Extract CVSS v3 score with source priority."""
    cvss = vuln_data.get('CVSS', {})

    for source in ['nvd', 'ghsa', 'redhat']:
        if source in cvss:
            score = cvss[source].get('V3Score')
            if score is not None:
                return score

    return 'N/A'

def generate_report_with_cvss(json_file):
    """Generate vulnerability report with CVSS scores."""
    with open(json_file, 'r') as f:
        data = json.load(f)

    print(f"{'Package':<20} {'CVE ID':<20} {'CVSS':<8} {'Severity':<10}")
    print("-" * 60)

    if 'Results' in data:
        for result in data['Results']:
            for vuln in result.get('Vulnerabilities', []):
                pkg = vuln.get('PkgName', 'Unknown')
                cve = vuln.get('VulnerabilityID', 'N/A')
                cvss = get_cvss_score(vuln)
                severity = vuln.get('Severity', 'UNKNOWN')

                print(f"{pkg:<20} {cve:<20} {cvss:<8} {severity:<10}")

# Usage
generate_report_with_cvss('trivy_report.json')
```

## Dependencies

### Python Modules
- `json` (standard library)

### Data Format
- Expects Trivy JSON format or similar structured vulnerability data

## References

- [CVSS v3.1 Specification](https://www.first.org/cvss/v3.1/specification-document)
- [NVD CVSS Calculator](https://nvd.nist.gov/vuln-metrics/cvss/v3-calculator)
- [GitHub Security Advisories](https://github.com/advisories)


## Original Skill: trivy-offline-vulnerability-scanning

---
name: trivy-offline-vulnerability-scanning
description: Use Trivy vulnerability scanner in offline mode to discover security vulnerabilities in dependency files. This skill covers setting up offline scanning, executing Trivy against package lock files, and generating JSON vulnerability reports without requiring internet access.
---

# Trivy Offline Vulnerability Scanning

This skill provides guidance on using Trivy, an open-source security scanner, to discover vulnerabilities in software dependencies using offline mode.

## Overview

Trivy is a comprehensive vulnerability scanner that can analyze various targets including container images, filesystems, and dependency lock files. **Offline scanning** is crucial for:
- Air-gapped environments without internet access
- Reproducible security audits with fixed vulnerability databases
- Faster CI/CD pipelines avoiding network latency
- Compliance requirements for controlled environments

## Why Offline Mode?

### Challenges with Online Scanning
- Network dependency introduces failure points
- Database updates can cause inconsistent results across runs
- Slower execution due to download times
- Security policies may restrict external connections

### Benefits of Offline Scanning
- **Reproducibility**: Same database = same results
- **Speed**: No network overhead
- **Reliability**: No external dependencies
- **Compliance**: Works in restricted environments

## Trivy Database Structure

Trivy's vulnerability database consists of:
- **trivy.db**: SQLite database containing CVE information
- **metadata.json**: Database version and update timestamp

Database location: `<cache-dir>/db/trivy.db`

## Offline Scanning Workflow

### Step 1: Verify Database Existence

Before scanning, ensure the offline database is available:

```python
import os
import sys

TRIVY_CACHE_PATH = './trivy-cache'

# Check for database file
db_path = os.path.join(TRIVY_CACHE_PATH, "db", "trivy.db")
if not os.path.exists(db_path):
    print(f"[!] Error: Trivy database not found at {db_path}")
    print("    Download database first with:")
    print(f"    trivy image --download-db-only --cache-dir {TRIVY_CACHE_PATH}")
    sys.exit(1)
```

### Step 2: Construct Trivy Command

Key flags for offline scanning:

| Flag | Purpose |
|------|---------|
| `fs <target>` | Scan filesystem/file (e.g., package-lock.json) |
| `--format json` | Output in JSON format for parsing |
| `--output <file>` | Save results to file |
| `--scanners vuln` | Scan only for vulnerabilities (not misconfigs) |
| `--skip-db-update` | **Critical**: Do not update database |
| `--offline-scan` | Enable offline mode |
| `--cache-dir <path>` | Path to pre-downloaded database |

```python
import subprocess

TARGET_FILE = 'package-lock.json'
OUTPUT_FILE = 'trivy_report.json'
TRIVY_CACHE_PATH = './trivy-cache'

command = [
    "trivy", "fs", TARGET_FILE,
    "--format", "json",
    "--output", OUTPUT_FILE,
    "--scanners", "vuln",
    "--skip-db-update",      # Prevent online updates
    "--offline-scan",         # Enable offline mode
    "--cache-dir", TRIVY_CACHE_PATH
]
```

### Step 3: Execute Scan

```python
try:
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False  # Don't raise exception on non-zero exit
    )

    if result.returncode != 0:
        print("[!] Trivy scan failed:")
        print(result.stderr)
        sys.exit(1)

    print("[*] Scan completed successfully")
    print(f"[*] Results saved to: {OUTPUT_FILE}")

except FileNotFoundError:
    print("[!] Error: 'trivy' command not found")
    print("    Install Trivy: https://aquasecurity.github.io/trivy/latest/getting-started/installation/")
    sys.exit(1)
```

## Complete Example

```python
import os
import sys
import subprocess

def run_trivy_offline_scan(target_file, output_file, cache_dir='./trivy-cache'):
    """
    Execute Trivy vulnerability scan in offline mode.

    Args:
        target_file: Path to file to scan (e.g., package-lock.json)
        output_file: Path to save JSON results
        cache_dir: Path to Trivy offline database
    """
    print(f"[*] Starting Trivy offline scan...")
    print(f"    Target: {target_file}")
    print(f"    Database: {cache_dir}")

    # Verify database exists
    db_path = os.path.join(cache_dir, "db", "trivy.db")
    if not os.path.exists(db_path):
        print(f"[!] Error: Database not found at {db_path}")
        sys.exit(1)

    # Build command
    command = [
        "trivy", "fs", target_file,
        "--format", "json",
        "--output", output_file,
        "--scanners", "vuln",
        "--skip-db-update",
        "--offline-scan",
        "--cache-dir", cache_dir
    ]

    # Execute
    try:
        result = subprocess.run(command, capture_output=True, text=True)

        if result.returncode != 0:
            print("[!] Scan failed:")
            print(result.stderr)
            sys.exit(1)

        print("[*] Scan completed successfully")
        return output_file

    except FileNotFoundError:
        print("[!] Trivy not found. Install from:")
        print("    https://aquasecurity.github.io/trivy/")
        sys.exit(1)

# Usage
if __name__ == "__main__":
    run_trivy_offline_scan(
        target_file='package-lock.json',
        output_file='trivy_report.json'
    )
```

## JSON Output Structure

Trivy outputs vulnerability data in this format:

```json
{
  "Results": [
    {
      "Target": "package-lock.json",
      "Vulnerabilities": [
        {
          "VulnerabilityID": "CVE-2021-44906",
          "PkgName": "minimist",
          "InstalledVersion": "1.2.5",
          "FixedVersion": "1.2.6",
          "Severity": "CRITICAL",
          "Title": "Prototype Pollution in minimist",
          "PrimaryURL": "https://avd.aquasec.com/nvd/cve-2021-44906",
          "CVSS": {
            "nvd": { "V3Score": 9.8 }
          }
        }
      ]
    }
  ]
}
```

## Common Issues

### Issue: "failed to initialize DB"
**Cause**: Database not found or corrupted
**Solution**: Re-download database or check `--cache-dir` path

### Issue: Scan finds no vulnerabilities when they exist
**Cause**: Database is outdated
**Solution**: Download newer database (before going offline)

### Issue: "command not found: trivy"
**Cause**: Trivy not installed or not in PATH
**Solution**: Install Trivy following official documentation

## Dependencies

### Required Tools
- **Trivy**: Version 0.40.0 or later recommended
  ```bash
  # Installation (example for Debian/Ubuntu)
  wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | apt-key add -
  echo "deb https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" | tee -a /etc/apt/sources.list.d/trivy.list
  apt-get update
  apt-get install trivy
  ```

### Python Modules
- `subprocess` (standard library)
- `os` (standard library)
- `sys` (standard library)

## References

- [Trivy Documentation](https://aquasecurity.github.io/trivy/)
- [Trivy Offline Mode Guide](https://aquasecurity.github.io/trivy/latest/docs/advanced/air-gap/)
- [CVE Database](https://cve.mitre.org/)


## Original Skill: vulnerability-csv-reporting

---
name: vulnerability-csv-reporting
description: Generate structured CSV security audit reports from vulnerability data with proper filtering and formatting. This skill covers CSV schema design for security reports, using Python csv.DictWriter, severity-based filtering, and field mapping from JSON to tabular format.
---

# Vulnerability CSV Report Generation

This skill provides guidance on generating structured CSV reports from vulnerability scan data—a common format for security audits and compliance reporting.

## Overview

CSV (Comma-Separated Values) is a widely-used format for security reports because it's:
- **Human-readable**: Can be opened in Excel, Google Sheets
- **Machine-parseable**: Easy to process programmatically
- **Universal**: Supported by all data analysis tools
- **Lightweight**: Smaller than JSON/XML formats

## When to Use CSV Reports

### Ideal Use Cases
- Compliance audits requiring tabular data
- Executive summaries for non-technical stakeholders
- Integration with ticketing systems (Jira, ServiceNow)
- Automated vulnerability tracking pipelines
- Data analysis in spreadsheet tools

### Limitations
- No hierarchical data (flat structure only)
- Limited support for nested information
- No standard for binary data

**Alternative formats**: JSON (for APIs), PDF (for formal reports), HTML (for dashboards)

## CSV Schema Design for Security Reports

### Essential Fields

A well-designed vulnerability report CSV should include:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| **Package** | String | Vulnerable package name | `express` |
| **Version** | String | Installed version | `4.17.1` |
| **CVE_ID** | String | Vulnerability identifier | `CVE-2022-24999` |
| **Severity** | Enum | Risk level | `CRITICAL`, `HIGH` |
| **CVSS_Score** | Float/String | Numeric severity score | `9.8` or `N/A` |
| **Fixed_Version** | String | Patched version | `4.18.0` or `N/A` |
| **Title** | String | Brief description | `XSS in Express.js` |
| **Url** | String | Reference link | `https://nvd.nist.gov/...` |

### Design Principles

1. **Use descriptive column names**: `Package` not `pkg`, `CVE_ID` not `id`
2. **Handle missing data**: Use `N/A` for unavailable fields, not empty strings
3. **Consistent data types**: Ensure all rows have same format
4. **Include metadata**: Consider adding scan date, target, tool version

## Python CSV Generation with DictWriter

### Why DictWriter?

Python's `csv.DictWriter` is ideal for structured reports:
- **Type-safe**: Column names defined upfront
- **Readable**: Use dictionary keys instead of indices
- **Maintainable**: Easy to add/remove columns
- **Automatic header generation**: No manual header writing

### Basic Usage

```python
import csv

# Define schema
headers = ["Package", "Version", "CVE_ID", "Severity", "CVSS_Score",
           "Fixed_Version", "Title", "Url"]

# Prepare data
vulnerabilities = [
    {
        "Package": "minimist",
        "Version": "1.2.5",
        "CVE_ID": "CVE-2021-44906",
        "Severity": "CRITICAL",
        "CVSS_Score": 9.8,
        "Fixed_Version": "1.2.6",
        "Title": "Prototype Pollution",
        "Url": "https://avd.aquasec.com/nvd/cve-2021-44906"
    }
]

# Write CSV
with open('security_audit.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=headers)
    writer.writeheader()  # Write column names
    writer.writerows(vulnerabilities)  # Write all rows
```

**Important parameters**:
- `newline=''`: Prevents extra blank lines on Windows
- `encoding='utf-8'`: Handles special characters in descriptions

## Severity-Based Filtering

### Why Filter by Severity?

Security teams prioritize based on risk. Filtering ensures reports focus on critical issues:

| Severity | Action Required | Typical SLA |
|----------|----------------|-------------|
| **CRITICAL** | Immediate patch | 24 hours |
| **HIGH** | Urgent patch | 7 days |
| **MEDIUM** | Scheduled patch | 30 days |
| **LOW** | Optional patch | 90 days |

### Implementation

```python
def filter_high_severity(vulnerabilities, min_severity=['HIGH', 'CRITICAL']):
    """
    Filter vulnerabilities by severity level.

    Args:
        vulnerabilities: List of vulnerability dictionaries
        min_severity: List of severity levels to include

    Returns:
        Filtered list containing only specified severity levels
    """
    filtered = []
    for vuln in vulnerabilities:
        if vuln.get('Severity') in min_severity:
            filtered.append(vuln)
    return filtered

# Usage
all_vulns = [...]  # From scanner
critical_vulns = filter_high_severity(all_vulns, ['CRITICAL', 'HIGH'])
```

## Field Mapping from JSON to CSV

### Extracting Fields from Scanner Output

```python
import json

def parse_trivy_json_to_csv_records(json_file):
    """
    Parse Trivy JSON output and extract CSV-ready records.

    Returns list of dictionaries, one per vulnerability.
    """
    with open(json_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    records = []

    if 'Results' in data:
        for result in data['Results']:
            target = result.get('Target', 'Unknown')

            for vuln in result.get('Vulnerabilities', []):
                # Map JSON fields to CSV fields
                record = {
                    "Package": vuln.get('PkgName'),
                    "Version": vuln.get('InstalledVersion'),
                    "CVE_ID": vuln.get('VulnerabilityID'),
                    "Severity": vuln.get('Severity', 'UNKNOWN'),
                    "CVSS_Score": extract_cvss_score(vuln),
                    "Fixed_Version": vuln.get('FixedVersion', 'N/A'),
                    "Title": vuln.get('Title', 'No description'),
                    "Url": vuln.get('PrimaryURL', '')
                }
                records.append(record)

    return records

def extract_cvss_score(vuln):
    """Extract CVSS score (from cvss-score-extraction skill)."""
    cvss = vuln.get('CVSS', {})
    for source in ['nvd', 'ghsa', 'redhat']:
        if source in cvss:
            score = cvss[source].get('V3Score')
            if score is not None:
                return score
    return 'N/A'
```

## Complete Vulnerability CSV Report Generator

```python
import json
import csv
import sys

def generate_vulnerability_csv_report(
    json_input,
    csv_output,
    severity_filter=['HIGH', 'CRITICAL']
):
    """
    Generate filtered CSV security report from Trivy JSON output.

    Args:
        json_input: Path to Trivy JSON report
        csv_output: Path for output CSV file
        severity_filter: List of severity levels to include
    """
    # Read JSON
    try:
        with open(json_input, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"[!] Error: Could not find {json_input}")
        sys.exit(1)

    # Extract and filter vulnerabilities
    vulnerabilities = []

    if 'Results' in data:
        for result in data['Results']:
            for vuln in result.get('Vulnerabilities', []):
                severity = vuln.get('Severity', 'UNKNOWN')

                # Apply severity filter
                if severity in severity_filter:
                    vulnerabilities.append({
                        "Package": vuln.get('PkgName'),
                        "Version": vuln.get('InstalledVersion'),
                        "CVE_ID": vuln.get('VulnerabilityID'),
                        "Severity": severity,
                        "CVSS_Score": get_cvss_score(vuln),
                        "Fixed_Version": vuln.get('FixedVersion', 'N/A'),
                        "Title": vuln.get('Title', 'No description'),
                        "Url": vuln.get('PrimaryURL', '')
                    })

    # Write CSV
    if vulnerabilities:
        headers = ["Package", "Version", "CVE_ID", "Severity",
                   "CVSS_Score", "Fixed_Version", "Title", "Url"]

        with open(csv_output, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
            writer.writerows(vulnerabilities)

        print(f"\n[SUCCESS] Found {len(vulnerabilities)} "
              f"{'/'.join(severity_filter)} vulnerabilities")
        print(f"[SUCCESS] Report saved to: {csv_output}")
    else:
        print(f"\n[SUCCESS] No {'/'.join(severity_filter)} vulnerabilities found")

def get_cvss_score(vuln_data):
    """Extract CVSS score with source priority."""
    cvss = vuln_data.get('CVSS', {})
    for source in ['nvd', 'ghsa', 'redhat']:
        if source in cvss:
            score = cvss[source].get('V3Score')
            if score is not None:
                return score
    return 'N/A'

# Usage
if __name__ == "__main__":
    generate_vulnerability_csv_report(
        json_input='trivy_report.json',
        csv_output='security_audit.csv',
        severity_filter=['CRITICAL', 'HIGH']
    )
```

## Advanced Patterns

### Pattern 1: Adding Metadata Row

```python
import csv
from datetime import datetime

# Add metadata as first row
metadata = {
    "Package": f"Scan Date: {datetime.now().isoformat()}",
    "Version": "Tool: Trivy v0.40.0",
    "CVE_ID": "Target: package-lock.json",
    "Severity": "", "CVSS_Score": "", "Fixed_Version": "",
    "Title": "", "Url": ""
}

with open('report.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=headers)
    writer.writeheader()
    writer.writerow(metadata)  # Metadata row
    writer.writerow({})  # Blank separator
    writer.writerows(vulnerabilities)  # Actual data
```

### Pattern 2: Multi-Target Reports

```python
def generate_multi_target_report(json_input, csv_output):
    """Include target/file name in each row."""
    with open(json_input, 'r') as f:
        data = json.load(f)

    vulnerabilities = []

    for result in data.get('Results', []):
        target = result.get('Target', 'Unknown')

        for vuln in result.get('Vulnerabilities', []):
            record = {
                "Target": target,  # Add target column
                "Package": vuln.get('PkgName'),
                # ... other fields
            }
            vulnerabilities.append(record)

    headers = ["Target", "Package", "Version", ...]  # Target first
    # Write CSV as before
```

### Pattern 3: Summary Statistics

```python
def print_report_summary(vulnerabilities):
    """Print summary before writing CSV."""
    from collections import Counter

    severity_counts = Counter(v['Severity'] for v in vulnerabilities)

    print("\nVulnerability Summary:")
    print(f"  CRITICAL: {severity_counts.get('CRITICAL', 0)}")
    print(f"  HIGH:     {severity_counts.get('HIGH', 0)}")
    print(f"  Total:    {len(vulnerabilities)}")
```

## Error Handling

### Handling Missing or Malformed Data

```python
def safe_get_field(vuln, field, default='N/A'):
    """Safely extract field with default fallback."""
    value = vuln.get(field, default)
    # Ensure value is not None
    return value if value is not None else default

# Usage in field mapping
record = {
    "Package": safe_get_field(vuln, 'PkgName', 'Unknown'),
    "Fixed_Version": safe_get_field(vuln, 'FixedVersion', 'N/A'),
    # ...
}
```

## Best Practices

1. **Always write headers**: Makes CSV self-documenting
2. **Use UTF-8 encoding**: Handles international characters
3. **Set newline=''**: Prevents blank lines on Windows
4. **Validate data**: Check for None/null values before writing
5. **Add timestamp**: Include scan date for tracking
6. **Document schema**: Maintain a data dictionary
7. **Test with edge cases**: Empty results, missing fields

## Dependencies

### Python Modules
- `csv` (standard library)
- `json` (standard library)

### Input Format
- Requires structured vulnerability data (typically JSON from scanners)

## References

- [Python CSV Documentation](https://docs.python.org/3/library/csv.html)
- [RFC 4180 - CSV Format Specification](https://tools.ietf.org/html/rfc4180)
- [NIST Vulnerability Database](https://nvd.nist.gov/)
