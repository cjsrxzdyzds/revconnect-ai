"""Run the RevConnectAI v5 Colab notebook locally, unmodified on disk.

The notebook is written for Google Colab (writes to /content, uses google.colab
uploads, IPython display, and launches Gradio with share=True). This harness
executes the notebook's code cells in one namespace with small, explicit
patches so the same logic runs on a normal Linux box.

Usage:
    python run_local.py                # build index + run test questions, no UI
    python run_local.py --ui           # also launch the Gradio app locally
    python run_local.py --stop-at 19   # stop after cell 19
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import traceback
from pathlib import Path

REPO = Path(__file__).resolve().parent
PROTOTYPE = REPO / "RevConnectAI_v5_API_Prototype"
NOTEBOOK = PROTOTYPE / "RevConnectAI_Full_Student_Engagement_Assistant_v5_API.ipynb"
LOCAL_HOME = Path(os.environ.get("REVCONNECT_DATA_DIR", REPO / ".revconnect_local"))
SERVER_HOST = os.environ.get("GRADIO_SERVER_NAME", "127.0.0.1")
SERVER_PORT = int(os.environ.get("GRADIO_SERVER_PORT", "7899"))

# Cell-source rewrites: (pattern, replacement), applied to every code cell.
# Patterns are regexes so small edits to the notebook cannot silently stop a
# patch from matching; a patch that matches nothing is reported at the end.
PATCHES = [
    # Colab-only project root -> local writable directory.
    (r'PROJECT_DIR\s*=\s*Path\(["\']/content/revconnect_ai["\']\)',
     f'PROJECT_DIR = Path(r"{LOCAL_HOME}")'),
    # Do not open a public Gradio tunnel; bind a high local port instead.
    # Keeps **LAUNCH_KWARGS so the GW favicon survives the rewrite.
    (r'demo\.launch\([^)]*\)',
     f'demo.launch(share=False, debug=False, server_name="{SERVER_HOST}", '
     f'server_port={SERVER_PORT}, inbrowser=False, prevent_thread_lock=True, **LAUNCH_KWARGS)'),
]


def display(*objects):
    """Stand-in for IPython's display()."""
    for obj in objects:
        print(obj)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ui", action="store_true", help="launch the Gradio interface")
    parser.add_argument("--serve", action="store_true", help="launch the UI without running notebook evaluation cells")
    parser.add_argument("--stop-at", type=int, default=None, help="last cell index to run")
    args = parser.parse_args()

    LOCAL_HOME.mkdir(parents=True, exist_ok=True)
    knowledge_dir = LOCAL_HOME / "knowledge_base"
    knowledge_dir.mkdir(parents=True, exist_ok=True)
    for source in (REPO / "RevConnectAI_Knowledge_Base_v4").glob("*.csv"):
        shutil.copy2(source, knowledge_dir / source.name)
    # The notebook's auto_locate_knowledge_sources() rglobs from cwd for the
    # knowledge-base ZIP, so run from the directory that ships it.
    os.chdir(PROTOTYPE)

    notebook = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    namespace = {"__name__": "__main__", "display": display}
    applied: set[str] = set()

    for index, cell in enumerate(notebook["cells"]):
        if cell["cell_type"] != "code":
            continue
        if args.stop_at is not None and index > args.stop_at:
            print(f"\n[harness] stopping before cell {index}")
            break

        source = "".join(cell["source"])
        if source.lstrip().startswith("!"):
            print(f"[harness] cell {index}: skipping shell/pip cell")
            continue
        if args.serve and index in (27, 29):
            print(f"[harness] cell {index}: skipping startup evaluation")
            continue
        if index == 33 and not (args.ui or args.serve):
            print("[harness] cell 33: skipping Gradio launch (pass --ui to run it)")
            continue

        for pattern, replacement in PATCHES:
            source, count = re.subn(pattern, replacement, source)
            if count:
                applied.add(pattern)
                print(f"[harness] cell {index}: applied patch {pattern[:38]!r}")

        print(f"\n{'=' * 78}\n[harness] running cell {index}\n{'=' * 78}")
        try:
            exec(compile(source, f"<cell {index}>", "exec"), namespace)
        except Exception:
            print(f"\n[harness] CELL {index} FAILED", file=sys.stderr)
            traceback.print_exc()
            return 1

    missed = [pattern for pattern, _ in PATCHES if pattern not in applied]
    if missed:
        # A patch that stops matching means the notebook drifted: without the
        # rewrite this would write to /content or open a public share tunnel.
        print("\n[harness] WARNING: these patches matched nothing:", file=sys.stderr)
        for pattern in missed:
            print(f"  {pattern}", file=sys.stderr)

    print("\n[harness] all cells completed")
    if args.ui or args.serve:
        print(f"[harness] Gradio running at http://{SERVER_HOST}:{SERVER_PORT} — Ctrl-C to stop")
        try:
            namespace["demo"].block_thread()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
