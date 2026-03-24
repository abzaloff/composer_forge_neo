from __future__ import annotations

import importlib.util
import subprocess
import sys


def is_installed(import_name: str) -> bool:
    try:
        return importlib.util.find_spec(import_name) is not None
    except ModuleNotFoundError:
        return False


def run_pip_install(*packages: str) -> None:
    if not packages:
        return
    print(f"[composer_forge_neo] Installing packages: {' '.join(packages)}")
    subprocess.run([sys.executable, "-m", "pip", "install", *packages], check=True)


def install() -> None:
    if not is_installed("rembg"):
        print("[composer_forge_neo] rembg is missing, starting installation")
        try:
            # Keep Forge/Neo pinned deps (for example scikit-image from requirements.txt)
            # untouched: install extension package itself without dependency resolution.
            run_pip_install("--no-deps", "rembg")
            print("[composer_forge_neo] rembg installation completed")
        except subprocess.CalledProcessError as err:
            print(f"[composer_forge_neo] rembg auto-install failed (non-fatal): {err}")
            print(
                "[composer_forge_neo] You can install it manually with:\n"
                f'  "{sys.executable}" -m pip install --no-deps rembg'
            )


try:
    import launch

    skip_install = launch.args.skip_install
except Exception:
    skip_install = False

if not skip_install:
    install()
