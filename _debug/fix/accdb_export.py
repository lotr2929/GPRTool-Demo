# accdb_export.py: Script to export Microsoft Access database tables to CSV files.
"""
accdb_export.py
GPRTool - Microsoft Access Database Exporter

Connects to LAI Database1.accdb via pyodbc (Microsoft Access ODBC driver),
lists all tables, and exports each table to CSV in the same folder.

Requirements:
    - Microsoft Access ODBC driver (comes with MS Office or Access Runtime)
    - pyodbc: pip install pyodbc

Usage (PowerShell):
    cd C:\\GPRToolDemo
    .venv\\Scripts\\Activate.ps1
    pip install pyodbc
    python accdb_export.py

Outputs:
    GPR - LAI Values/accdb_export/<TableName>.csv  (one per table)
    GPR - LAI Values/accdb_export/accdb_schema.txt (table/column listing)

Author: Boon + Claude
Date: 2026-03-17
"""

import csv
import os
import sys

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
LAI_DIR    = os.path.join(BASE_DIR, "GPR - LAI Values")
ACCDB_PATH = os.path.join(LAI_DIR, "LAI Database1.accdb")
OUT_DIR    = os.path.join(LAI_DIR, "accdb_export")


def get_connection(accdb_path):
    """Connect to .accdb using Microsoft Access ODBC driver."""
    try:
        import pyodbc
    except ImportError:
        print("ERROR: pyodbc not installed.")
        print("Run: pip install pyodbc")
        sys.exit(1)

    # Try both 64-bit and 32-bit drivers
    drivers = [
        "Microsoft Access Driver (*.mdb, *.accdb)",
        "Microsoft Access Driver (*.mdb)",
    ]
    conn_str = None
    for driver in drivers:
        if driver in pyodbc.drivers():
            conn_str = (
                f"DRIVER={{{driver}}};"
                f"DBQ={accdb_path};"
                "ExtendedAnsiSQL=1;"
            )
            print(f"  Using driver: {driver}")
            break

    if not conn_str:
        print("\nERROR: No Microsoft Access ODBC driver found.")
        print("Install the free Access Runtime from Microsoft:")
        print("  https://www.microsoft.com/en-us/download/details.aspx?id=54920")
        print("  Choose the 64-bit version to match your Python.")
        print("\nAvailable ODBC drivers on this machine:")
        for d in pyodbc.drivers():
            print(f"  {d}")
        sys.exit(1)

    return pyodbc.connect(conn_str)


def list_tables(conn):
    """Return list of user table names (excludes system tables)."""
    cursor = conn.cursor()
    tables = [
        row.table_name
        for row in cursor.tables(tableType="TABLE")
        if not row.table_name.startswith("MSys")
    ]
    return tables


def get_columns(conn, table_name):
    """Return list of (column_name, type_name) for a table."""
    cursor = conn.cursor()
    return [
        (col.column_name, col.type_name)
        for col in cursor.columns(table=table_name)
    ]


def export_table(conn, table_name, out_dir):
    """Export a single table to CSV. Returns row count."""
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM [{table_name}]")
    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()

    out_path = os.path.join(out_dir, f"{table_name}.csv")
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(columns)
        writer.writerows(rows)

    return len(rows), columns


def write_schema(tables_info, out_dir):
    """Write a human-readable schema summary."""
    lines = []
    lines.append("=" * 60)
    lines.append("LAI Database1.accdb — Schema Summary")
    lines.append("=" * 60)
    for tname, cols, nrows in tables_info:
        lines.append(f"\nTable: {tname}  ({nrows:,} rows)")
        for cname, ctype in cols:
            lines.append(f"  {cname:<35} {ctype}")
    out_path = os.path.join(out_dir, "accdb_schema.txt")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return out_path


def main():
    print("\nGPRTool Access DB Exporter")
    print("=" * 40)

    if not os.path.exists(ACCDB_PATH):
        print(f"ERROR: File not found:\n  {ACCDB_PATH}")
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"Database: {ACCDB_PATH}")
    print(f"Output:   {OUT_DIR}")

    print("\nConnecting...")
    conn = get_connection(ACCDB_PATH)
    print("Connected.")

    tables = list_tables(conn)
    print(f"\nFound {len(tables)} table(s): {', '.join(tables)}")

    tables_info = []
    for tname in tables:
        print(f"\nExporting: {tname}...")
        cols = get_columns(conn, tname)
        nrows, _ = export_table(conn, tname, OUT_DIR)
        tables_info.append((tname, cols, nrows))
        print(f"  {nrows:,} rows → {tname}.csv")

    schema_path = write_schema(tables_info, OUT_DIR)
    print(f"\nSchema written: {schema_path}")

    conn.close()
    print("\nDone. All tables exported to:")
    print(f"  {OUT_DIR}")
    print("\nNext step: share accdb_schema.txt content here")
    print("so we can update lai_explorer.py to read these tables.")


if __name__ == "__main__":
    main()
