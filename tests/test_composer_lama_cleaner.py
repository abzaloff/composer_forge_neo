import importlib.util
import io
import sys
import tempfile
import types
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


def load_composer_module():
    for name in [
        "gradio",
        "fastapi",
        "fastapi.responses",
        "modules",
        "modules.script_callbacks",
        "modules.ui_components",
    ]:
        sys.modules.pop(name, None)

    gradio = types.ModuleType("gradio")
    gradio.Blocks = object
    gradio.HTML = object
    gradio.Textbox = object
    gradio.Button = object
    gradio.Column = object
    sys.modules["gradio"] = gradio

    fastapi = types.ModuleType("fastapi")
    fastapi.Request = object
    sys.modules["fastapi"] = fastapi

    responses = types.ModuleType("fastapi.responses")
    responses.JSONResponse = dict
    sys.modules["fastapi.responses"] = responses

    callbacks = types.ModuleType("modules.script_callbacks")
    callbacks.on_ui_tabs = lambda *args, **kwargs: None
    callbacks.on_app_started = lambda *args, **kwargs: None
    callbacks.on_after_component = lambda *args, **kwargs: None

    ui_components = types.ModuleType("modules.ui_components")
    ui_components.ToolButton = object

    modules = types.ModuleType("modules")
    modules.script_callbacks = callbacks
    modules.ui_components = ui_components
    sys.modules["modules"] = modules
    sys.modules["modules.script_callbacks"] = callbacks
    sys.modules["modules.ui_components"] = ui_components

    spec = importlib.util.spec_from_file_location("composer_under_test", ROOT / "scripts" / "composer.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def png_bytes(color=(255, 0, 0, 255), size=(8, 8), mode="RGBA"):
    image = Image.new(mode, size, color)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


class ComposerLamaCleanerTests(unittest.TestCase):
    def setUp(self):
        self.composer = load_composer_module()

    def test_lama_cleaner_status_detects_importable_extension(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "lama_cleaner_masked_content"
            package.mkdir()
            (package / "__init__.py").write_text("", encoding="utf-8")
            (package / "inpaint.py").write_text("def lamaInpaint(*args, **kwargs): pass\n", encoding="utf-8")
            (package / "options.py").write_text(
                "def getLamaUpscaler(): return 'None'\n"
                "def getResolution(): return 512\n",
                encoding="utf-8",
            )

            status = self.composer._get_lama_cleaner_status([root])

        self.assertTrue(status["available"])
        self.assertEqual(status["path"], str(root))

    def test_lama_cleaner_status_reports_missing_extension(self):
        with tempfile.TemporaryDirectory() as tmp:
            status = self.composer._get_lama_cleaner_status([Path(tmp)])

        self.assertFalse(status["available"])
        self.assertIn("not found", status["error"].lower())

    def test_run_lama_cleaner_returns_png_bytes_from_extension_function(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "lama_cleaner_masked_content"
            package.mkdir()
            (package / "__init__.py").write_text("", encoding="utf-8")
            (package / "options.py").write_text(
                "def getLamaUpscaler(): return 'None'\n"
                "def getResolution(): return 512\n",
                encoding="utf-8",
            )
            (package / "inpaint.py").write_text(
                "from PIL import Image\n"
                "def lamaInpaint(image, mask, invert, upscaler, padding, resolution, blur):\n"
                "    result = image.copy().convert('RGBA')\n"
                "    result.paste(Image.new('RGBA', result.size, (0, 255, 0, 255)), mask.convert('L'))\n"
                "    return result\n",
                encoding="utf-8",
            )

            output = self.composer._run_lama_cleaner(
                png_bytes((255, 0, 0, 255)),
                png_bytes(255, mode="L"),
                search_roots=[root],
            )

        result = Image.open(io.BytesIO(output)).convert("RGBA")
        self.assertEqual(result.getpixel((0, 0)), (0, 255, 0, 255))

    def test_lama_cleaner_upscaler_falls_back_to_none_when_default_is_missing(self):
        modules = sys.modules["modules"]
        modules.shared = types.SimpleNamespace(
            sd_upscalers=[
                types.SimpleNamespace(name="None"),
                types.SimpleNamespace(name="Lanczos"),
            ]
        )

        upscaler = self.composer._get_lama_cleaner_upscaler(lambda: "ESRGAN_4x")

        self.assertEqual(upscaler, "None")


if __name__ == "__main__":
    unittest.main()
