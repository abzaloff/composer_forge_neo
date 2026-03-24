from __future__ import annotations

import importlib.util
from pathlib import Path
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


def is_rembg_runtime_ready() -> bool:
    # rembg runtime for this extension requires both top-level package and pymatting.
    return is_installed("rembg") and is_installed("pymatting")


def find_forge_requirements_path() -> Path | None:
    candidates: list[Path] = []

    try:
        import launch

        launch_file = Path(getattr(launch, "__file__", "")).resolve()
        if launch_file.name:
            candidates.append(launch_file.parent / "requirements.txt")
    except Exception:
        pass

    cwd = Path.cwd().resolve()
    candidates.extend([
        cwd / "requirements.txt",
        cwd.parent / "requirements.txt",
        Path(__file__).resolve().parent.parent / "requirements.txt",
    ])

    seen: set[str] = set()
    for candidate in candidates:
        norm = str(candidate).lower()
        if norm in seen:
            continue
        seen.add(norm)
        if candidate.is_file():
            return candidate
    return None


def install() -> None:
    if not is_rembg_runtime_ready():
        print("[composer_forge_neo] rembg runtime deps are missing, starting installation")
        try:
            requirements_path = find_forge_requirements_path()
            if requirements_path:
                print(f"[composer_forge_neo] Using Forge constraints: {requirements_path}")
                # Install rembg and let pip resolve deps, but constrain versions to Forge pins
                # when the same packages are present in requirements.txt.
                run_pip_install("--constraint", str(requirements_path), "rembg")
            else:
                print("[composer_forge_neo] Forge requirements.txt not found; installing rembg without constraints")
                run_pip_install("rembg")
            print("[composer_forge_neo] rembg runtime installation completed")
        except subprocess.CalledProcessError as err:
            print(f"[composer_forge_neo] rembg runtime auto-install failed (non-fatal): {err}")
            manual_hint = f'"{sys.executable}" -m pip install rembg'
            requirements_path = find_forge_requirements_path()
            if requirements_path:
                manual_hint = f'"{sys.executable}" -m pip install --constraint "{requirements_path}" rembg'
            print(f"[composer_forge_neo] You can install it manually with:\n  {manual_hint}")


try:
    import launch

    skip_install = launch.args.skip_install
except Exception:
    skip_install = False

if not skip_install:
    install()
