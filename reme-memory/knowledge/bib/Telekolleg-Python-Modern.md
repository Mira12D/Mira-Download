# Telekolleg: Modern Python — Clean Code 2024

## REGEL: Immer diese Python-Basis verwenden

```python
#!/usr/bin/env python3
"""
Module description here.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

# Lokale Imports zuletzt


def main() -> None:
    """Entry point."""
    pass


if __name__ == "__main__":
    main()
```

Python 3.10+ Features nutzen. Type Hints überall. f-Strings statt format(). Pathlib statt os.path.

## Variablen & Typen

```python
# ❌ FALSCH
name = "Max"
list1 = []
dict1 = {}

# ✅ RICHTIG — mit Type Hints
name: str = "Max"
items: list[str] = []
config: dict[str, Any] = {}

# Konstanten: UPPER_SNAKE_CASE
MAX_RETRIES: int = 3
BASE_URL: str = "https://api.example.com"
```

## Dataclasses — statt rohe Dictionaries

```python
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class User:
    id: int
    name: str
    email: str
    created_at: datetime = field(default_factory=datetime.now)
    tags: list[str] = field(default_factory=list)
    active: bool = True

    def __post_init__(self) -> None:
        self.email = self.email.lower().strip()

    @property
    def display_name(self) -> str:
        return self.name.title()


# Verwendung
user = User(id=1, name="Max Mustermann", email="MAX@EXAMPLE.COM")
print(user.display_name)  # Max Mustermann
```

## Functions — Clean & Typed

```python
# ❌ FALSCH
def calc(a, b, t):
    if t == 'add':
        return a + b
    elif t == 'mul':
        return a * b

# ✅ RICHTIG
def add(a: float, b: float) -> float:
    """Add two numbers."""
    return a + b

def multiply(a: float, b: float) -> float:
    """Multiply two numbers."""
    return a * b

# Mit optionalen Parametern
def format_price(
    amount: float,
    currency: str = "EUR",
    decimals: int = 2,
) -> str:
    return f"{amount:.{decimals}f} {currency}"
```

## Error Handling — Spezifisch

```python
# ❌ FALSCH
try:
    result = risky_operation()
except:
    pass

# ✅ RICHTIG
import logging

logger = logging.getLogger(__name__)

def read_config(path: Path) -> dict[str, Any]:
    """Read JSON config file."""
    try:
        with path.open() as f:
            return json.load(f)
    except FileNotFoundError:
        logger.error("Config file not found: %s", path)
        return {}
    except json.JSONDecodeError as e:
        logger.error("Invalid JSON in %s: %s", path, e)
        raise ValueError(f"Invalid config: {e}") from e
```

## File I/O — immer Pathlib

```python
from pathlib import Path
import json
import csv

# ❌ FALSCH
import os
path = os.path.join(os.getcwd(), "data", "file.json")
f = open(path, 'r')

# ✅ RICHTIG
data_dir = Path(__file__).parent / "data"
config_file = data_dir / "config.json"

# JSON lesen/schreiben
def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))

def save_json(data: dict, path: Path, indent: int = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=indent), encoding="utf-8")

# CSV
def read_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def write_csv(data: list[dict], path: Path) -> None:
    if not data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)
```

## List Comprehensions & Generators

```python
numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# Filtern & Transformieren
evens       = [n for n in numbers if n % 2 == 0]
squares     = [n ** 2 for n in numbers]
even_squares = [n ** 2 for n in numbers if n % 2 == 0]

# Dict Comprehension
word_lengths = {word: len(word) for word in ["apple", "banana", "cherry"]}

# Generator (speichersparend für große Daten)
def large_file_lines(path: Path):
    with path.open() as f:
        yield from f

# Sorted mit Key
users_sorted = sorted(users, key=lambda u: u.name.lower())
users_by_id  = sorted(users, key=lambda u: u.id, reverse=True)
```

## API Requests — httpx (async)

```python
import httpx
from typing import Any

async def fetch_json(url: str, params: dict | None = None) -> dict[str, Any]:
    """Fetch JSON from URL."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()

async def post_json(url: str, data: dict, headers: dict | None = None) -> dict:
    """POST JSON to URL."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            url,
            json=data,
            headers=headers or {"Content-Type": "application/json"},
        )
        response.raise_for_status()
        return response.json()
```

## Excel mit openpyxl

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

def create_excel_report(data: list[dict], output_path: Path) -> None:
    """Create styled Excel report."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Report"

    # Header Stil
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill("solid", fgColor="0071E3")
    header_align = Alignment(horizontal="center", vertical="center")

    # Spalten-Breiten
    headers = list(data[0].keys()) if data else []
    for col_idx, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=header.replace("_", " ").title())
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align
        ws.column_dimensions[cell.column_letter].width = max(15, len(header) + 4)

    # Daten
    for row_idx, row in enumerate(data, 2):
        for col_idx, value in enumerate(row.values(), 1):
            ws.cell(row=row_idx, column=col_idx, value=value)

    # Zeilen-Höhe
    ws.row_dimensions[1].height = 24

    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_path)
```

## Argument Parser — CLI Tools

```python
import argparse

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Tool description",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("input", type=Path, help="Input file path")
    parser.add_argument("-o", "--output", type=Path, default=Path("output.json"))
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--limit", type=int, default=100, metavar="N")
    return parser.parse_args()
```

## Logging — professionell

```python
import logging

def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

logger = logging.getLogger(__name__)

# Verwenden
logger.debug("Debug details: %s", data)
logger.info("Processing %d items", len(items))
logger.warning("Skipping invalid entry: %s", entry)
logger.error("Failed to connect: %s", error)
```

## VERBOTEN — niemals so:

```python
# ❌ niemals
exec("code")
eval("expression")
import *
print("debug")              # stattdessen logger.debug()
except: pass                # immer spezifisch
open("file.txt")            # ohne with-Statement
os.path.join(...)           # stattdessen pathlib
"Hello " + name + "!"      # stattdessen f"Hello {name}!"
```
