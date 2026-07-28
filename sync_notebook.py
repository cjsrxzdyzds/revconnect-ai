"""Regenerate the notebook cells that inline code kept in separate files.

The notebook must stay self-contained so it runs in Colab with nothing but the
knowledge-base ZIP. That forces two files to exist twice -- once as an editable
module, once as a notebook cell:

    campusgroups_api_client.py  ->  the API client cell
    revconnect_ui.py            ->  the Gradio interface cell

The files are the single source of truth; this script rewrites the cells from
them so the two copies cannot drift.

Usage:
    python sync_notebook.py           # rewrite the notebooks
    python sync_notebook.py --check   # exit 1 if they are out of date
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

REPO = Path(__file__).resolve().parent
NOTEBOOKS = [
    REPO / "RevConnectAI_v5_API_Prototype" / "RevConnectAI_Full_Student_Engagement_Assistant_v5_API.ipynb",
    REPO / "RevConnectAI_Full_Student_Engagement_Assistant_v5_API.ipynb",
]


@dataclass(frozen=True)
class CellSpec:
    """One generated cell: which file feeds it and how to find it."""

    source: Path
    # Must appear in exactly one code cell across the notebook. Keep it distinct
    # from anything in the import cell.
    locator: str
    # Where copying begins inside the source file.
    start_marker: str
    # If set, everything from this marker to the end of the existing cell is
    # notebook-only glue and is preserved below the copied code.
    glue_marker: Optional[str] = None

    def body(self) -> str:
        text = self.source.read_text(encoding="utf-8")
        index = text.find(self.start_marker)
        if index == -1:
            raise SystemExit(f"{self.source.name}: could not find {self.start_marker!r}")
        return text[index:].rstrip() + "\n"

    def banner(self) -> str:
        return (
            f"# This cell is generated from {self.source.name} by sync_notebook.py.\n"
            "# Edit that file, then rerun the script -- do not edit this cell directly.\n"
        )

    def rebuild(self, existing: str) -> str:
        body = self.body()
        if self.glue_marker is None:
            return self.banner() + "\n" + body
        glue_index = existing.find(self.glue_marker)
        if glue_index == -1:
            raise SystemExit(f"could not find the notebook glue {self.glue_marker!r}")
        return self.banner() + "\n" + body + "\n\n" + existing[glue_index:]


CELLS = [
    CellSpec(
        source=REPO / "RevConnectAI_v5_API_Prototype" / "campusgroups_api_client.py",
        locator="class CampusGroupsAPIError(RuntimeError):",
        start_marker="class CampusGroupsAPIError(RuntimeError):",
        glue_marker="CAMPUSGROUPS_CONFIG = CampusGroupsConfig(",
    ),
    # The UI file carries its own launch call, so there is no trailing glue.
    CellSpec(
        source=REPO / "revconnect_ui.py",
        locator="with gr.Blocks(",
        start_marker="import html",
    ),
]


def find_cell(notebook: dict, marker: str) -> dict:
    matches = [
        cell for cell in notebook["cells"]
        if cell["cell_type"] == "code" and marker in "".join(cell["source"])
    ]
    if len(matches) != 1:
        raise SystemExit(f"expected exactly 1 cell containing {marker!r}, found {len(matches)}")
    return matches[0]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify only; do not write")
    args = parser.parse_args()

    stale = False

    for notebook_path in NOTEBOOKS:
        if not notebook_path.exists():
            print(f"skipped (missing): {notebook_path}")
            continue

        notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
        changed = []

        for spec in CELLS:
            cell = find_cell(notebook, spec.locator)
            current = "".join(cell["source"])
            updated = spec.rebuild(current)
            if current == updated:
                continue
            changed.append(spec.source.name)
            cell["source"] = updated.splitlines(keepends=True)

        if not changed:
            print(f"up to date: {notebook_path.name}")
            continue

        stale = True
        if args.check:
            print(f"OUT OF DATE: {notebook_path.name} ({', '.join(changed)})")
            continue

        notebook_path.write_text(
            json.dumps(notebook, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"updated: {notebook_path.name} ({', '.join(changed)})")

    if args.check and stale:
        print("\nRun `python sync_notebook.py` to regenerate.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
