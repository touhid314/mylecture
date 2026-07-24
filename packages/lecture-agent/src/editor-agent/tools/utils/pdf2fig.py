import glob
import os
from pathlib import Path
from typing import Optional

import cv2
import torch
from doclayout_yolo import YOLOv10
from dotenv import load_dotenv
from pdf2image import convert_from_path

load_dotenv()

# ------------------------------ CONFIG ------------------------------
SCRIPT_DIR = Path(__file__).parent
MODEL_PATH = str(SCRIPT_DIR.parent / "models" / "doclayout_yolo_docstructbench_imgsz1024.pt")
DEFAULT_OUTPUT_ROOT = SCRIPT_DIR.parent / "outputs" / "img2fig"
DEFAULT_POPPLER_PATH = os.getenv("POPPLER_PATH") or str(SCRIPT_DIR.parent / "lib" / "poppler-25.11.0" / "Library" / "bin")

IMG_SIZE = 1024
CONF_THRES = 0.2
DEVICE = os.getenv("IMG2FIG_DEVICE", "auto")  # default: auto (GPU if available, else CPU)
PDF2IMG_THREADS = max(1, int(os.getenv("IMG2FIG_PDF_THREADS", str(os.cpu_count() or 4))))
# -------------------------------------------------------------------


def find_image_paths(root_dir: str):
    exts = ("*.png", "*.jpg", "*.jpeg", "*.bmp", "*.tif", "*.tiff", "*.webp")
    paths = []
    for ext in exts:
        paths.extend(glob.glob(os.path.join(root_dir, ext)))
    return sorted(paths)


def _existing_crops(figures_dir: Path) -> list[Path]:
    if not figures_dir.exists():
        return []
    return sorted(list(figures_dir.glob("figure_*.png")) + list(figures_dir.glob("table_*.png")))


def get_page_stem(image_path: str) -> str:
    return Path(image_path).stem


def get_class_name(names, cls_id: int) -> str:
    if isinstance(names, dict):
        return str(names.get(cls_id, cls_id))
    if isinstance(names, (list, tuple)) and cls_id < len(names):
        return str(names[cls_id])
    return str(cls_id)


def _normalize_device(device: str) -> str:
    """
    doclayout_yolo expects GPU device as '0', '1', ... (not 'cuda:0').
    Returns a safe value accepted by the underlying library.
    """
    d = (device or "").strip().lower()
    if not d:
        return "0"
    if d == "auto":
        return "0" if torch.cuda.is_available() else "cpu"
    if d in {"cpu", "mps"}:
        return d
    if d.startswith("cuda:"):
        idx = d.split(":", 1)[1]
        return idx if idx.isdigit() else ("0" if torch.cuda.is_available() else "cpu")
    if d == "cuda":
        return "0" if torch.cuda.is_available() else "cpu"
    # Keep numeric forms such as "0" / "0,1"
    return d


def _resolve_runtime_device(device: str) -> str:
    normalized = _normalize_device(device)
    if normalized != "cpu" and not torch.cuda.is_available():
        raise RuntimeError(
            "GPU device was requested, but CUDA is not available in this Python environment. "
            "Current torch build is likely CPU-only. "
            "Install a CUDA-enabled torch build in this environment, or set IMG2FIG_DEVICE=cpu to run on CPU."
        )
    return normalized


def crop_and_save(img_bgr, box_xyxy, out_dir, label: str, idx: int):
    x1, y1, x2, y2 = [int(round(v)) for v in box_xyxy]
    h, w = img_bgr.shape[:2]
    x1 = max(0, min(x1, w - 1))
    x2 = max(0, min(x2, w - 1))
    y1 = max(0, min(y1, h - 1))
    y2 = max(0, min(y2, h - 1))
    if x2 <= x1 or y2 <= y1:
        return False

    crop = img_bgr[y1:y2, x1:x2]
    out_path = os.path.join(out_dir, f"{label}_{idx}.png")
    cv2.imwrite(out_path, crop)
    return True


def process_image(
    model: YOLOv10,
    image_path: str,
    figures_dir: str,
    next_figure_idx: int,
    next_table_idx: int,
    device: str = DEVICE,
) -> tuple[int, int, int, int]:
    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        print(f"[WARN] Could not read image: {image_path}")
        return 0, 0, next_figure_idx, next_table_idx

    results = model.predict(
        image_path,
        imgsz=IMG_SIZE,
        conf=CONF_THRES,
        device=device,
        verbose=False,
    )
    if not results:
        print(f"[INFO] No results for: {Path(image_path).name}")
        return 0, 0, next_figure_idx, next_table_idx

    names = getattr(results[0], "names", None) or getattr(model, "names", None)
    boxes = results[0].boxes
    if boxes is None or len(boxes) == 0:
        print(f"[INFO] No boxes for: {image_path}")
        return 0, 0, next_figure_idx, next_table_idx

    xyxy = boxes.xyxy.cpu().numpy()
    clss = boxes.cls.cpu().numpy().astype(int)

    # Enforce deterministic on-page reading order: top-to-bottom, then left-to-right.
    # This ensures figure/table numbering reflects visual order on the page.
    sorted_indices = sorted(
        range(xyxy.shape[0]),
        key=lambda i: (float(xyxy[i][1]), float(xyxy[i][0])),
    )

    figure_count = 0
    table_count = 0
    for i in sorted_indices:
        cls_id = int(clss[i])
        cls_name = get_class_name(names, cls_id).lower()
        if cls_name == "figure":
            saved = crop_and_save(img_bgr, xyxy[i], figures_dir, "figure", next_figure_idx)
            if saved:
                figure_count += 1
                next_figure_idx += 1
        elif cls_name == "table":
            saved = crop_and_save(img_bgr, xyxy[i], figures_dir, "table", next_table_idx)
            if saved:
                table_count += 1
                next_table_idx += 1

    page_name = Path(image_path).name
    print(f"[OK] Processed {page_name}: saved {figure_count} figure(s), {table_count} table(s)")
    return figure_count, table_count, next_figure_idx, next_table_idx


def render_pdf_to_images(
    pdf_path: str,
    pages_dir: str,
    poppler_path: Optional[str] = None,
    dpi: int = 200,
    thread_count: int = PDF2IMG_THREADS,
) -> list[str]:
    Path(pages_dir).mkdir(parents=True, exist_ok=True)
    threads = max(1, int(thread_count))
    print(f"[INFO] PDF->image thread_count={threads}")
    images = convert_from_path(
        pdf_path,
        fmt="png",
        dpi=dpi,
        poppler_path=poppler_path or DEFAULT_POPPLER_PATH,
        thread_count=threads,
    )
    image_paths: list[str] = []
    for i, img in enumerate(images, start=1):
        page_path = Path(pages_dir) / f"page_{i:04d}.png"
        img.save(page_path, "PNG")
        image_paths.append(str(page_path))
    return image_paths


def extract_figures_from_images(
    root_images_dir: str,
    output_dir: str,
    model_path: str = MODEL_PATH,
    device: str = DEVICE,
) -> str:
    runtime_device = _resolve_runtime_device(device)
    print(f"[INFO] Using device: {runtime_device}")
    print("[INFO] Loading doclayout YOLO model...")
    model = YOLOv10(model_path)

    all_images = find_image_paths(root_images_dir)
    if not all_images:
        print(f"[INFO] No images found under: {root_images_dir}")
        return ""

    Path(output_dir).mkdir(parents=True, exist_ok=True)
    print(f"[INFO] Found {len(all_images)} images. Saving to: {output_dir}")
    total_figures = 0
    total_tables = 0
    next_figure_idx = 1
    next_table_idx = 1
    for img_path in all_images:
        saved_figures, saved_tables, next_figure_idx, next_table_idx = process_image(
            model,
            img_path,
            output_dir,
            next_figure_idx=next_figure_idx,
            next_table_idx=next_table_idx,
            device=runtime_device,
        )
        total_figures += saved_figures
        total_tables += saved_tables

    print(
        f"[DONE] All images processed. Total extracted figures: {total_figures}, "
        f"tables: {total_tables}"
    )
    return output_dir


def extract_figures_from_pdf(
    pdf_path: str,
    output_root: str | Path = DEFAULT_OUTPUT_ROOT,
    model_path: str = MODEL_PATH,
    device: str = DEVICE,
    poppler_path: Optional[str] = None,
    dpi: int = 200,
    pdf2img_thread_count: int = PDF2IMG_THREADS,
    reuse_existing: bool = True,
    save_page_img: bool = False,
) -> str:
    pdf = Path(pdf_path)
    if not pdf.exists():
        raise FileNotFoundError(f"PDF not found: {pdf}")

    base_dir = Path(output_root)
    pages_dir = base_dir / "pdf2img"
    figures_dir = base_dir / "pdf2fig"
    figures_dir.mkdir(parents=True, exist_ok=True)

    existing_crops = _existing_crops(figures_dir)
    if reuse_existing and existing_crops:
        print(f"[INFO] Reusing existing figure/table crops ({len(existing_crops)} files): {figures_dir}")
        return str(figures_dir)

    existing_pages = find_image_paths(str(pages_dir)) if pages_dir.exists() else []
    if reuse_existing and existing_pages:
        print(f"[INFO] Reusing existing pdf2img pages ({len(existing_pages)} images): {pages_dir}")
        image_paths = existing_pages
    else:
        print(f"[INFO] Rendering PDF pages to images: {pdf}")
        image_paths = render_pdf_to_images(
            pdf_path=str(pdf),
            pages_dir=str(pages_dir),
            poppler_path=poppler_path,
            dpi=dpi,
            thread_count=pdf2img_thread_count,
        )
    if not image_paths:
        print("[INFO] No pages rendered from PDF.")
        return str(figures_dir)

    print(f"[INFO] Running model on {len(image_paths)} page images...")
    extract_figures_from_images(
        root_images_dir=str(pages_dir),
        output_dir=str(figures_dir),
        model_path=model_path,
        device=device,
    )

    if not save_page_img and pages_dir.exists():
        import shutil
        print(f"[INFO] Cleaning up temporary page images in: {pages_dir}")
        shutil.rmtree(pages_dir, ignore_errors=True)

    print(f"[DONE] Figure crops saved under: {figures_dir}")
    return str(figures_dir)


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Extract figures and tables from a PDF using DocLayout-YOLO")
    parser.add_argument("--pdf", required=True, help="Path to input PDF file")
    parser.add_argument("--output", help="Path to output root folder")
    parser.add_argument("--device", default=DEVICE, help="Execution device (e.g., cpu, 0)")
    parser.add_argument("--poppler", help="Path to poppler bin folder")
    parser.add_argument("--save-page-img", action="store_true", help="Save the full page images alongside the crops")
    args = parser.parse_args()

    try:
        out = extract_figures_from_pdf(
            pdf_path=args.pdf,
            output_root=args.output or DEFAULT_OUTPUT_ROOT,
            device=args.device,
            poppler_path=args.poppler or DEFAULT_POPPLER_PATH,
            save_page_img=args.save_page_img
        )
        print(f"SUCCESS: {out}")
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        sys.exit(1)

